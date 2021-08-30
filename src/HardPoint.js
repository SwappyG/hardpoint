import {
  DISCORD_TEXT_CMD,
  STATE,
  EVENT,
  TRANSITIONS,
  INITIAL_DATA,
  EXPECTED_WORDS as WORDS
} from './Constants.js'

import { DiscordClient } from './DiscordClient.js'
import { StateMachine } from './StateMachine.js'
import { GSpeechClient } from './GoogleSpeechClient.js'
import { existsSync, readFileSync } from 'fs';


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

    this.gspeech_client = new GSpeechClient(
      'discordbot',
      args.gspeech_key_file_path,
      Object.values(WORDS).flat()
    )

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
      if (this._detected(cmds, [[DISCORD_TEXT_CMD.REPEAT_SPAWN]])) { return this.event_repeat_spawn(msg) }
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
    if (this._detected(tokens, [WORDS['gm'], WORDS['game'], WORDS['start']])) {
      msg['args'] = { '_': ['start'] }
      return this.event_start(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['game'], WORDS['cancel']])) {
      msg['args'] = { '_': ['cancel'] }
      return this.event_cancel(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['dead'], WORDS['respawn']])) {
      msg['args'] = { '_': ['respawn'], 'name': msg.user_name }
      return this.event_respawn(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['last'], WORDS['respawn']])) {
      msg['args'] = { '_': ['repeat'], 'name': msg.user_name }
      return this.event_repeat_spawn(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['point'], WORDS['capture']])) {
      msg['args'] = { '_': ['capture'], 'name': msg.user_name, 'seize': false }
      return this.event_capture(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['seize'], WORDS['point']])) {
      msg['args'] = { '_': ['capture'], 'name': msg.user_name, 'seize': true }
      return this.event_capture(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['point'], WORDS['release']])) {
      msg['args'] = { '_': ['release'], 'name': msg.user_name }
      return this.event_release(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['add'], WORDS['team_name']])) {
      msg['args'] = {
        '_': ['player', 'add'],
        'name': msg.user_name,
        'team': this._detected(tokens, ['blue']) ? 'blue' : 'red'
      }
      return this.event_player(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['alias']])) {
      const index = tokens.findIndex((token) => token === 'to')
      if (index === -1 || (index + 1 >= tokens.length)) {
        this._log(f`Couldn't determine alias from [${tokens.join(' ')}]`)
        return
      }

      msg['args'] = {
        '_': ['player', 'set'],
        'name': msg.user_name,
        'alias': tokens[index + 1]
      }
      return this.event_player_set(msg)
    }

    if (this._detected(tokens, [WORDS['gm'], WORDS['switch'], WORDS['team']])) {
      msg['args'] = {
        '_': ['player', 'switch'],
        'name': msg.user_name,
      }
      return this.event_player_switch(msg)
    }
  }

  get_spawn_options = ({ owner, team, other_team, latest_team_spawn, latest_other_team_spawn, active_point_spawns }) => {
    switch (owner) {
      case team:
        return active_point_spawns['capturing']

      case 'neutral': // fallthrough
      case 'contested':
        const options = active_point_spawns['neutral']
        if (options[0].includes(latest_team_spawn) || options[1].includes(latest_other_team_spawn)) {
          return options[0]
        }

        if (options[1].includes(latest_team_spawn) || options[0].includes(latest_other_team_spawn)) {
          return options[1]
        }

        return options[0].concat(options[1])

      default:
        return active_point_spawns['other']
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
    return `${mins < 10 ? '0' : ''} ${mins}: ${secs < 10 ? '0' : ''} ${secs} `
  }

  score_interval_func = (set_data, get_data) => {
    const data = get_data()

    // don't spam too much
    const sec = Math.floor((Date.now() - data.start_time) / 1000)
    if (sec % 10 == 0) {
      const game_status =
        `[${this.get_clock_time_string(data.game_timer)}] | ` +
        `Red ${data.red_team_score} vs ${data.blue_team_score} Blue\n` +
        `Hardpoint: ${data.active_point} [${data.hardpoint_owner}]\n` +
        `Capturing: ${Object.keys(data.players).map((name) => {
          return `\n  - ${name} ${data.players[name].is_capturing ? 'is' : 'is not'} capturing`
        })
        } ` + `\n\n`
      this._log(game_status, { ...data.discord, 'no_voice': true })
    }
    if (sec % 20 == 0) {
      if (data.red_team_score > data.blue_team_score) {
        this._log(`${data.red_team_score} to ${data.blue_team_score} red`, data.discord)
      } else if (data.red_team_score < data.blue_team_score) {
        this._log(`${data.blue_team_score} to ${data.red_team_score} blue`, data.discord)
      } else {
        this._log(`tied at ${data.blue_team_score} `, data.discord)
      }
    }

    const prev_owner = data.hardpoint_owner
    const capture_tally = this.get_capture_tally(data.players)
    const hardpoint_owner = this.get_hardpoint_owner(capture_tally)
    set_data('hardpoint_owner', hardpoint_owner)
    if (hardpoint_owner !== prev_owner) {
      this._log(`hardpoint is ${hardpoint_owner} `, data.discord)
    }

    switch (hardpoint_owner) {
      case 'red':
        set_data('red_team_score', data.red_team_score + 1)
        break
      case 'blue':
        set_data('blue_team_score', data.blue_team_score + 1)
        break
      default:
        set_data('game_timer', data.game_timer + 1)
        if ((data.game_time_limit - data.game_timer) < 60 && (!data.one_minute_notified)) {
          this._log(`one minute remaining`, data.discord)
          set_data('one_minute_notified', true)
        }

        if ((data.game_time_limit - data.game_timer) < 30 && (!data.half_minute_notified)) {
          this._log(`30 seconds remaining`, data.discord)
          set_data('half_minute_notified', true)
        }

        if ((data.game_time_limit - data.game_timer) <= 10) {
          this._log(`${data.game_time_limit - data.game_timer} `, data.discord)
        }
        break
    }

    if (data.game_timer > data.game_time_limit) {
      this.event_game_end({ 'canceled': false })
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
    this._log(`the new hardpoint is[${next_point}]`, data.discord)
  }

  event_attach_async_helper = async (msg, data, set_data) => {
    const args = msg.args
    const name = msg.args.name ?? 'General'
    const type = msg.args.type ?? 'voice'
    const channels = this.discord_client.get_channels(msg.guild_id, type)
    if (channels === undefined) {
      return
    }

    const channel_id = channels.get(name)
    set_data(['discord', `${type}_channel_id`], channel_id)
    set_data(['discord', `${type}_channel_name`], name)

    if (type === 'voice') {
      await this.discord_client.join_voice_channel(channel_id, async (msg) => {
        await this._on_discord_voice_message(msg)
      })
      this._log(`attached to voice channel ${name} `, data.discord, msg.user_id)
    } else {
      this._log(`attached to text channel ${name} `, data.discord, msg.user_id)
    }
  }

  event_attach = (msg) => {
    const on_success = (data, set_data) => {
      // run our async helper, with a done event pushed on completion
      this.event_attach_async_helper(msg, data, set_data).then(() => {
        this.sm.push_event(EVENT.SETTINGS_UPDATE_DONE, () => { return true })
      })
    }

    return this.sm.push_event(EVENT.SETTINGS_UPDATE_ASYNC, () => { return true }, on_success)
  }

  event_cancel = (msg) => {
    return this.event_game_end({ 'canceled': true })
  }

  event_capture = (msg) => {
    return this.sm.push_event(EVENT.GAME_UPDATE, (data, set_data) => {
      const player_name = msg.args['name'] ?? msg.user_name
      const player = data.players[player_name]
      if (player === undefined) {
        return
      }

      if (msg.args['seize'] === true) {
        for (const name in data.players) {
          if (data.players[name].team != data.players[player_name].team) {
            set_data(['players', name, 'is_capturing'], false)
          }
        }
        this._log(`${player.alias} seized the hardpoint`, data.discord)
      } else {
        this._log(`${player.alias} is capturing the hardpoint`, data.discord)
      }
      set_data(['players', player_name, 'is_capturing'], true)

      return true
    })
  }

  event_connect = (msg) => {
    return this.sm.push_event(EVENT.CONNECT, (data, set_data, get_data) => {
      set_data(['discord', 'guild_id'], msg.guild_id)
      set_data(['discord', 'guild_name'], msg.guild_name)
      set_data(['discord', 'text_channel_id'], msg.channel_id)
      set_data(['discord', 'text_channel_name'], msg.channel_name)
      this._log(`connected to[${msg.guild_name}: ${msg.channel_name}]`, get_data().discord, msg.user_id)
      return true
    })
  }

  event_detach = (msg) => {
    return this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
      this.discord_client.leave_voice_channel(data.discord.guild_id)
      this._log(`left voice channel: ${data.discord.voice_channel_name} `, data.discord, msg.user_id)
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

  event_game_end = ({ canceled }) => {
    return this.sm.push_event(EVENT.GAME_DONE, (data, set_data) => {
      if (canceled) {
        this._log('the game was canceled early', data.discord)
      }

      const game_summary =
        `Game complete.Summary: \n` +
        `[${this.get_clock_time_string(data.game_timer)}] | ` +
        `Red ${data.red_team_score} vs ${data.blue_team_score} Blue`
      this._log(game_summary, { ...data.discord, 'no_voice': true })

      if (data.red_team_score > data.blue_team_score) {
        this._log(`Game over, red wins by ${data.red_team_score - data.blue_team_score} points`, data.discord)
      } else if (data.red_team_score < data.blue_team_score) {
        this._log(`Game over, blue wins by ${data.blue_team_score - data.red_team_score} points`, data.discord)
      } else {
        if (data.red_team_score > data.blue_team_score) {
          this._log(`Game over, tied at ${data.blue_team_score} `, data.discord)
        }
      }

      clearInterval(data.clock)
      clearInterval(data.hardpoint_clock)
      set_data('clock', null)
      set_data('hardpoint_clock', null)
      return true
    })
  }

  event_help = (msg) => {
    const reply = `Available Commands: ` +
      `- connect - moves system to connected state.starts accepting commands` +
      `- disconnect - moves system to disconnected state.stops accepting commands(except connect)`
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
      this._log(`${JSON.stringify(data.players, null, 4)} `, { ...data.discord, 'no_voice': true }, msg.user)
      return true
    })
  }

  event_player = (msg) => {
    const args = msg.args
    const sub_cmd = args['_']
    const valid_cmds = ['add', 'remove', 'purge', 'switch', 'list', 'set']

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

    if (this._detected(sub_cmd, [['set']])) {
      return this.event_player_set(msg)
    }

    this._log(`player command must be followed by one of: ${valid_cmds} `, data.discord, msg.user_id)
  }

  event_player_set = (msg) => {
    const args = msg.args
    if (!this._verify_args(args, ['name'])) {
      return
    }

    if (args.hasOwnProperty('team')) {
      this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
        if (!data.players.hasOwnProperty(args.name)) {
          this._log(`player was never added[${args.name}]`, data.discord, msg.user_id)
          return true
        }

        if ((args.team !== 'red') && (args.team !== 'blue')) {
          this._log(`team must be blue or red[${args.team}]`, data.discord, msg.user_id)
          return
        }

        set_data(['players', args.name, 'team'], args.team)
        this._log(`player [${args.name}] is now on team [${args.team}]`, data.discord, msg.user_id)
        return true
      })
    }

    if (args.hasOwnProperty('alias')) {
      this.sm.push_event(EVENT.SETTINGS_UPDATE, (data, set_data) => {
        if (!data.players.hasOwnProperty(args.name)) {
          this._log(`player was never added[${args.name}]`, data.discord, msg.user_id)
          return true
        }

        set_data(['players', args.name, 'alias'], args.alias)
        this._log(`alias for player [${args.name}] is now [${args.alias}]`, data.discord, msg.user_id)
        return true
      })
    }
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
        'alias': args.alias,
        'deaths': 0,
        'latest_spawn_point': null,
        'is_capturing': false
      })

      this._log(`player [${args.name}] added to team [${args.team}] with alias [${args.alias}]`, data.discord, msg.user_id)
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

    if (!args.hasOwnProperty('alias')) {
      args['alias'] = args.name
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
    return this.sm.push_event(EVENT.GAME_UPDATE, (data, set_data) => {
      const player_name = msg.args['name'] ?? msg.user_name
      const player = data.players[player_name]
      if (player === undefined) {
        return
      }

      this._log(`${player.alias} is not capturing the hardpoint`, { ...data.discord, 'no_voice': true })
      set_data(['players', player_name, 'is_capturing'], false)
      return true
    })
  }

  event_repeat_spawn = (msg) => {
    this.sm.push_event(EVENT.GAME_UPDATE, (data, set_data) => {
      const player_name = msg.args['name'] ?? msg.user_name
      if (!data.players.hasOwnProperty(player_name)) {
        this._log(`player doesn't exist [${player_name}]`, data.discord, msg.user_id)
        return true
      }

      const player = data.players[player_name]
      this._log(`player ${player.alias} last respawn was ${player.latest_spawn_point}`, data.discord, msg.user_id)
      return true
    })
  }

  event_respawn = (msg) => {
    this.sm.push_event(EVENT.GAME_UPDATE, (data, set_data) => {
      const player_name = msg.args['name'] ?? msg.user_name
      if (!data.players.hasOwnProperty(player_name)) {
        this._log(`player doesn't exist [${player_name}]`, data.discord, msg.user_id)
        return true
      }

      const player = data.players[player_name]
      const other_team = player.team === 'blue' ? 'red' : 'blue'
      const latest_team_spawn = data[`latest_${player.team}_spawn`]
      const latest_other_team_spawn = data[`latest_${other_team}_spawn`]
      const options = this.get_spawn_options({
        'owner': data.hardpoint_owner,
        'team': player.team,
        'other_team': other_team,
        'latest_team_spawn': latest_team_spawn,
        'latest_other_team_spawn': latest_other_team_spawn,
        'active_point_spawns': data.spawns[data.active_point]
      })
      const respawn_point = this._sample_array(options)

      this._log(`player ${player.alias} should respawn to ${respawn_point}`, data.discord, msg.user_id)

      set_data(`latest_${player.team}_spawn`, respawn_point)
      set_data(['players', player_name, 'is_capturing'], false)
      set_data(['players', player_name, 'latest_spawn_point'], respawn_point)
      set_data(['players', player_name, 'deaths'], data.players[player_name].deaths + 1)
      return true
    })
  }

  event_start = (msg) => {
    return this.sm.push_event(EVENT.START, (data, set_data, get_data) => {
      console.log(data.discord)
      if (data.discord.voice_channel_id === null || data.discord.voice_channel_name === null) {
        this._log(`Can't start until bot is attached a voice channel`, data.discord, msg.user)
        return false
      }

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

      this._log(`The first hard point is ${data.active_point}`, data.discord, msg.user)

      for (const player_name in data.players) {
        set_data(['players', player_name, 'deaths'], 0)
        set_data(['players', player_name, 'is_capturing'], false)
        set_data(['players', player_name, 'latest_spawn_point'], null)
        this.event_respawn({
          ...msg,
          args: {
            '_': ['respawn'],
            'name': player_name
          }
        })
      }

      console.log(`Initial game state\n\n${data}\n`)

      return true
    })
  }
}

export {
  HardPoint
}