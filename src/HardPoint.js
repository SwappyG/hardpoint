import { DISCORD_TEXT_CMD, STATE, EVENT, TRANSITIONS, INITIAL_DATA } from './Constants.js'
import { DiscordClient } from './DiscordClient.js'
import { StateMachine } from './StateMachine.js'
import { GSpeechClient } from './GoogleSpeechClient.js'
import { existsSync, readFileSync } from 'fs';

const POINT_LIKE = ['point', 'location', 'objective', 'target']
const CAPTURE_LIKE = ['capture', 'capturing', 'captured']
const RELEASE_LIKE = ['release', 'releasing', 'released']
const DEAD_LIKE = ['undead', 'dead', 'died']
const RESPAWN_LIKE = ['respawn', 'spawn', 'respond']
const ADD_LIKE = ['add', 'join']
const RED_OR_BLUE = ['red', 'blue']
const START_LIKE = ['start', 'begin']
const GAME_LIKE = ['game', 'match']
const GM_LIKE_LIKE = ['bass', 'base', 'duo', 'proto', 'lan', 'roll', 'row', 'zero', '0']

class HardPoint {
  constructor(args) {
    if (!existsSync(args.game_data_file_path)) {
      throw Error(`the file [${args.game_data_file_path}] does not exist`)
    }

    this.game_data = JSON.parse(readFileSync(args.game_data_file_path))
    this.initial_data = INITIAL_DATA
    this.initial_data.spawns = this.game_data.spawn_config ?? []
    this.initial_data.hardpoint_names = this.game_data.hardpoint_names ?? []
    this.initial_data.spawn_point_names = this.game_data.spawn_point_names ?? []
    this.sm = new StateMachine({
      'name': 'hardpoint',
      'transition_table': TRANSITIONS,
      'initial_state': STATE.DISCONNECTED,
      'loop_period': 10,
      'initial_data': this.initial_data
    })

    this.gspeech_client = new GSpeechClient('discordbot', args.gspeech_key_file_path)
    this.discord_client = new DiscordClient(
      args.discord_token_file_path, this._on_discord_message,
      (text) => { return this.gspeech_client.generate_speech(text) }
    )
  }

  _log = (text, discord_data, discord_user_id) => {
    console.log(text)
    if (discord_user_id) {
      discord_data['user_id'] = discord_user_id
    }
    this.discord_client.send_message(text, discord_data)
  }

  _on_discord_message = (msg) => {
    const cmds = msg.args['_'].map((v) => { return v.toLowerCase() })
    try {
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.CONNECT]])) { return this.event_connect(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.DISCONNECT]])) { return this.event_disconnect(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.ATTACH]])) { return this.event_attach(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.DETACH]])) { return this.event_detach(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.PLAYER]])) { return this.event_player(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.START]])) { return this.event_start(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.CANCEL]])) { return this.event_cancel(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.CAPTURE]])) { return this.event_capture(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.RELEASE]])) { return this.event_release(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.RESPAWN]])) { return this.event_respawn(msg) }
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.HELP]])) { return this.event_help(msg) }

      this._log(`invalid command: ${msg.args['_']}`, msg, msg.user)
      return
    } catch (e) {
      console.log(e.stack)
    }
  }

  _sample_array = (arr) => {
    return arr[Math.floor(Math.random() * arr.length)]
  }

  /**
   * @param {list of lists of string} criterias - Consider the following possible input:
   * [ [a, b, c], [d], [e, f] ]
   * This will be interpretted as (a or b or c) and (d) and (e or f) 
   */
  _detected = (tokens, criterias) => {
    return criterias.every((criteria) => {
      return tokens.some((token) => { return criteria.includes(token) })
    })
  }

  _verify_args = (args, expected_args, discord_data) => {
    return expected_args.reduce((accum, arg) => {
      if (!args.hasOwnProperty(arg)) {
        this._log(`missing arg [${arg}]`, discord_data)
        accum = false
      }
      return accum
    }, true)
  }

  _on_discord_voice_message = async (msg) => {
    const transcription = await this.gspeech_client.transcribe_gspeech(msg.voice_buffer)
    const tokens = transcription.split(" ").map((token) => { return token.toLowerCase() })
    if (this._detected(tokens, [GM_LIKE_LIKE, GAME_LIKE, START_LIKE])) {
      msg['args'] = { '_': ['start'] }
      return this.event_start(msg)
    }

    if (this._detected(tokens, [GM_LIKE_LIKE, DEAD_LIKE, RESPAWN_LIKE])) {
      msg['args'] = { '_': ['respawn'], 'name': msg.user_name }
      return this.event_respawn(msg)
    }

    if (this._detected(tokens, [GM_LIKE_LIKE, POINT_LIKE, CAPTURE_LIKE])) {
      msg['args'] = { '_': ['capture'], 'name': msg.user_name }
      return this.event_capture(msg)
    }

    if (this._detected(tokens, [GM_LIKE_LIKE, POINT_LIKE, RELEASE_LIKE])) {
      msg['args'] = { '_': ['release'], 'name': msg.user_name }
      return this.event_release(msg)
    }

    if (this._detected(tokens, [GM_LIKE_LIKE, ADD_LIKE, RED_OR_BLUE])) {
      msg['args'] = {
        '_': ['player', 'add'],
        'name': msg.user_name,
        'team': this._detected(tokens, ['blue']) ? 'blue' : 'red'
      }
      return this.event_player(msg)
    }
  }

  _event_capture_or_release = (msg, is_capturing) => {
    return this.sm.push_event(EVENT.GAME_UPDATE, (data, set_data) => {
      const player_name = msg.args['name'] ?? msg.user_name
      set_data(['players', player_name, 'is_capturing'], is_capturing)
      return true
    })
  }

  get_spawn_options = (hardpoint_owner, player_team, latest_team_spawn, active_point_data) => {
    switch (hardpoint_owner) {
      case player_team:
        return active_point_data['capturing']

      case 'neutral': // fallthrough
      case 'contested':
        const options = active_point_data['neutral']
        if (options[0].includes(latest_team_spawn)) {
          return options[0]
        }

        if (options[1].includes(latest_team_spawn)) {
          return options[1]
        }

        return options[0].concat(options[1])

      default:
        return active_point_data['other']
    }
  }

  get_capture_tally = (players) => {
    const tally = { 'red': 0, 'blue': 0 }
    for (const player_name in players) {
      if (players[player_name].is_capturing) {
        tally[players[player_name].team]++
      }
    }
    return tally
  }

  get_hardpoint_owner = (capture_tally) => {
    if (capture_tally.red != 0 && capture_tally.blue != 0) {
      return 'contested'
    }

    if (capture_tally.red == 0 && capture_tally.blue == 0) {
      return 'neutral'
    }

    return capture_tally.red != 0 ? 'red' : 'blue'
  }

  get_clock_time_string = (t) => {
    const secs = t % 60
    const mins = Math.floor(t / 60)
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  score_interval_func = (set_data, get_data) => {
    const data = get_data()

    // don't spam too much
    if (Math.floor((Date.now() - data.start_time) / 1000) % 10 == 0) {
      const game_status =
        `[${this.get_clock_time_string(data.game_timer)}] | ` +
        `Red ${data.red_team_score} vs ${data.blue_team_score} Blue\n` +
        `Hardpoint: ${data.active_point} [${data.hardpoint_owner}]\n` +
        `Capturing: ${Object.keys(data.players).map((name) => {
          return `\n  - ${name} ${data.players[name].is_capturing ? 'is' : 'is not'} capturing`
        })}` + `\n\n`
      this._log(game_status, data.discord)
    }

    const capture_tally = this.get_capture_tally(data.players)
    const hardpoint_owner = this.get_hardpoint_owner(capture_tally)
    set_data('hardpoint_owner', hardpoint_owner)

    switch (hardpoint_owner) {
      case 'red':
        set_data('red_team_score', data.red_team_score + 1)
        break
      case 'blue':
        set_data('blue_team_score', data.blue_team_score + 1)
        break
      default:
        set_data('game_timer', data.game_timer + 1)
        break
    }

    if (data.game_timer > data.game_time_limit) {
      this.event_game_end()
    }
  }

  hardpoint_rotation_interval_func = (set_data, get_data) => {
    const data = get_data()
    const active_point = data.active_point
    const hardpoint_names = data.hardpoint_names
    const next_point = hardpoint_names[(hardpoint_names.indexOf(active_point) + 1) % hardpoint_names.length]

    for (const name in data.players) {
      set_data(['players', name, 'is_capturing'], false)
    }
    set_data('active_point', next_point)
    this._log(`the new hardpoint is [${next_point}]`, data.discord)
  }

  event_attach_async_helper = async (msg, data, set_data) => {
    const args = msg.args
    const channels = this.discord_client.get_channels(msg.guild_id, args.type)
    if (!channels.has(args.name)) {
      this._log(`invalid channel name [${args.name}]`, data.discord, msg.user_id)
      return
    }

    const channel_id = channels.get(args.name)
    set_data(`${args.type}_channel_id`, channel_id)
    set_data(`${args.type}_channel_name`, args.name)
    this._log(`attached to ${args.type} channel ${args.name}`, data.discord, msg.user_id)

    if (args.type === 'voice') {
      await this.discord_client.join_voice_channel(channel_id, async (msg) => {
        await this._on_discord_voice_message(msg)
      })
    }
  }

  event_attach = (msg) => {
    const args = msg.args
    if (!this._verify_args(args, ['type', 'name'], msg)) {
      return
    }

    const on_success = (data, set_data) => {
      // run our async helper, with a done event pushed on completion
      this.event_attach_async_helper(msg, data, set_data).then(() => {
        this.sm.push_event(EVENT.SETTINGS_UPDATE_DONE, () => { return true })
      })
    }

    return this.sm.push_event(EVENT.SETTINGS_UPDATE_ASYNC, () => { return true }, on_success)
  }

  event_cancel = (msg) => {
    return this.event_game_end()
  }

  event_capture = (msg) => {
    return this._event_capture_or_release(msg, true)
  }

  event_connect = (msg) => {
    return this.sm.push_event(EVENT.CONNECT, (data, set_data, get_data) => {
      set_data(['discord', 'guild_id'], msg.guild_id)
      set_data(['discord', 'guild_name'], msg.guild_name)
      set_data(['discord', 'text_channel_id'], msg.channel_id)
      set_data(['discord', 'text_channel_name'], msg.channel_name)
      this._log(`connected to [${msg.guild_name}: ${msg.channel_name}]`, get_data().discord, msg.user_id)
      return true
    })
  }

  event_detach = (msg) => {
    return this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
      this.discord_client.leave_voice_channel(data.guild_id)
      this._log(`left voice channel: ${data.voice_channel_name}`, data.discord, msg.user_id)
      set_data(['discord', 'voice_channel_id'], null)
      set_data(['discord', 'voice_channel_name'], null)
      return true
    })
  }

  event_disconnect = (msg) => {
    return this.sm.push_event(EVENT.DISCONNECT, (data, set_data) => {
      this._log(`Ignoring this guild until connect command`, data.discord, msg.user_id)
      set_data(null, this.initial_data)
      return true
    })
  }

  event_game_end = () => {
    return this.sm.push_event(EVENT.GAME_DONE, (data, set_data) => {
      const game_summary =
        `Game complete. Summary:\n` +
        `[${this.get_clock_time_string(data.game_timer)}] | ` +
        `Red ${data.red_team_score} vs ${data.blue_team_score} Blue`
      this._log(game_summary, { ...data.discord, 'no_voice': true })

      clearInterval(data.clock)
      clearInterval(data.hardpoint_clock)
      set_data('clock', null)
      set_data('hardpoint_clock', null)
      return true
    })
  }

  event_help = (msg) => {
    const reply = `Available Commands:` +
      `- connect - moves system to connected state. starts accepting commands` +
      `- disconnect - moves system to disconnected state. stops accepting commands (except connect)`
    this._log(reply, msg, msg.user_id)
  }

  event_player_purge = (msg) => {
    this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
      set_data('players', {})
      this._log(`all players purged`, data.discord, msg.user_id)
      return true
    })
  }

  event_player_list = (msg) => {
    this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
      this._log(`${JSON.stringify(data.players, null, 4)}`, data.discord, msg.user)
      return true
    })
  }

  event_player = (msg) => {
    const args = msg.args
    const sub_cmd = args['_']
    const valid_cmds = ['add', 'remove', 'purge', 'switch', 'list']

    if (this._detected(sub_cmd, [['add']])) {
      return this.event_player_add(msg)
    }

    if (this._detected(sub_cmd, [['remove']])) {
      return this.event_player_remove(msg)
    }

    if (this._detected(sub_cmd, [['purge']])) {
      return this.event_player_purge(msg)
    }

    if (this._detected(sub_cmd, [['switch']])) {
      return this.event_player_switch(msg)
    }

    if (this._detected(sub_cmd, [['list']])) {
      return this.event_player_list(msg)
    }

    this._log(`player command must be followed by one of: ${valid_cmds}`, data.discord, msg.user_id)
  }

  event_player_add_helper = async (args, data, set_data, msg) => {
    if (data.players.hasOwnProperty(args.name)) {
      this._log(`player already added [${args.name}]`, data.discord, msg.user_id)
      return
    }

    try {
      const player_id = await this.discord_client.get_member_id(data.discord.guild_id, args.name)
      if (player_id === undefined) {
        this._log(`player wasn't found [${args.name}]`, data.discord, msg.user_id)
        return
      }

      set_data(['players', args.name], {
        'id': player_id,
        'team': args.team,
        'is_capturing': false
      })

      this._log(`player added [${args.name}]`, data.discord, msg.user_id)
    } catch (err) {
      this._log(`unable to fetch player [${args.name}], got [${err}]`, data.discord, msg.user_id)
      return
    }
  }

  event_player_add = (msg) => {
    const args = msg.args
    if (!this._verify_args(args, ['name', 'team'], msg)) {
      return
    }

    if ((args.team !== 'red') && (args.team !== 'blue')) {
      this._log(`team must be blue or red [${args.team}]`, data.discord, msg.user_id)
      return
    }

    this.sm.push_event(EVENT.SETTINGS_UPDATE_ASYNC, () => { return true }, (data, set_data) => {
      this.event_player_add_helper(args, data, set_data, msg).then(() => {
        this.sm.push_event(EVENT.SETTINGS_UPDATE_DONE, () => { return true })
      })
    })
  }

  event_player_remove = (msg) => {
    const args = msg.args
    if (!this._verify_args(args, ['name'], msg)) {
      return
    }

    this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
      delete data.players[args.name]
      set_data('players', data.players)
      this._log(`player removed [${args.name}]`, data.discord, msg.user_id)
      return true
    })
  }

  event_player_switch = (msg) => {
    const args = msg.args
    if (!this._verify_args(args, ['name'], msg)) {
      return
    }

    this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
      if (!data.players.hasOwnProperty(args.name)) {
        this._log(`player was never added [${args.name}]`, data.discord, msg.user_id)
        return true
      }

      const new_team = (data.players[args.name].team === 'blue') ? 'red' : 'blue'
      set_data(['players', args.name, 'team'], new_team)

      this._log(`player [${args.name}] switched teams to team [${new_team}]`, data.discord, msg.user_id)
      return true
    })
  }

  event_release = (msg) => {
    return this._event_capture_or_release(msg, false)
  }

  event_respawn = (msg) => {
    this.sm.push_event(EVENT.GAME_UPDATE, (data, set_data) => {
      const player_name = msg.args['name'] ?? msg.user_name
      if (!data.players.hasOwnProperty(player_name)) {
        this._log(`player doesn't exist [${player_name}]`, data.discord, msg.user_id)
        return true
      }

      const player = data.players[player_name]
      const latest_team_spawn = data[`latest_${player.team}_spawn`]
      const options = this.get_spawn_options(
        data.hardpoint_owner, player.team, latest_team_spawn, data.spawns[data.active_point])
      const respawn_point = this._sample_array(options)

      this._log(`player ${player_name} should respawn to ${respawn_point}`, data.discord, msg.user_id)

      set_data(`latest_${player.team}_spawn`, respawn_point)
      set_data(['players', player_name, 'is_capturing'], false)
      return true
    })
  }

  event_start = (msg) => {
    return this.sm.push_event(EVENT.START, (data, set_data, get_data) => {
      set_data('hardpoint_owner', 'neutral')
      set_data('red_team_score', 0)
      set_data('blue_team_score', 0)
      set_data('start_time', Date.now())
      set_data('game_timer', 0.0)
      set_data('active_point', data.hardpoint_names[0])

      const score_interval_handle = setInterval(
        () => { this.score_interval_func(set_data, get_data) }, 1000)

      const hardpoint_rotation_interval_handle = setInterval(
        () => { this.hardpoint_rotation_interval_func(set_data, get_data) },
        1000 * data.point_rotation_time)

      set_data('clock', score_interval_handle)
      set_data('hardpoint_clock', hardpoint_rotation_interval_handle)

      this._log(`The game has been started!`, data.discord, msg.user)
      console.log(`Initial game state\n\n${data}\n`)

      return true
    })
  }
}

export {
  HardPoint
}