import { Constants, Client } from 'discord.js'
import minimist from 'minimist';
import { parseArgsStringToArgv } from 'string-argv'
import { existsSync, readFileSync } from 'fs';
import { StateMachine } from './StateMachine.js';

const _MIN_SPEECH_DURATION = 1.0
const _MAX_SPEECH_DURATION = 19.0
const _AUDIO_BITRATE = 48000
const _BYTES_PER_PACKET = 4

const _DISCORD_PREFIX = '$';

const _SPEAKING_SM_TRANSITIONS = new Map([
  ['speaking', new Map([
    ['done', 'idle'],
    ['phrase', 'speaking']
  ])],
  ['idle', new Map([['phrase', 'speaking']])],
])

class DiscordClient {
  constructor(token_file_path, on_parsed_message, tts_engine) {
    this.on_parsed_message = on_parsed_message
    this.voice_connections = new Map()
    this.client = new Client()
    this.tts_engine = tts_engine
    this.streams = []
    this.is_speaking = false

    this.client.on(Constants.Events.CLIENT_READY, this._on_discord_ready)
    this.client.on(Constants.Events.MESSAGE_CREATE, this._on_discord_message)

    if (!existsSync(token_file_path)) {
      throw Error(`the file [${args.game_data_file_path}] does not exist`)
    }

    this.client.login(JSON.parse(readFileSync(token_file_path)).discord_token)

    this.streams_interval = setInterval(() => {
      if (!this.is_speaking) {
        const elem = this.streams.shift()
        if (elem !== undefined) {
          this.is_speaking = true
          this.speak(elem.guild_id, elem.stream)
        }
      }
    })
  }

  get_channels = (guild_id, channel_type) => {
    switch (channel_type) {
      case 'voice':
        return this.get_voice_channels(guild_id)
      case 'text':
        return this.get_text_channels(guild_id)
      default:
        return
    }
  }

  get_voice_channels = (guild_id) => {
    return this._get_channels(guild_id, 'voice')
  }

  get_text_channels = (guild_id) => {
    return this._get_channels(guild_id, 'text')
  }

  get_member_id = async (guild_id, member_name) => {
    const members = await this.client.guilds.cache.get(guild_id).members.fetch({
      'query': member_name,
      'time': 100
    })

    const guild_member = members.find((member, id) => {
      return member.user.username === member_name
    })

    return guild_member?.id
  }

  join_voice_channel = async (voice_channel_id, on_audio_callback) => {
    if (this.voice_connections.has(voice_channel_id)) {
      throw Error(`Already connected to [${voice_channel_id}]`)
    }

    let voice_channel = await this.client.channels.fetch(voice_channel_id)
    if (!voice_channel) {
      throw Error(`Voice channel [${voice_channel_id}] does not exist!`)
    }

    const guild_id = voice_channel.guild.id
    let voice_connection = await voice_channel.join()
    voice_connection.on('speaking', (user, speaking) => {
      this._on_speaking(on_audio_callback, voice_channel, voice_connection, user, speaking)
    })

    this.voice_connections.set(guild_id, voice_connection)
  }

  speak = (guild_id, stream) => {
    if (!this.voice_connections.has(guild_id)) {
      console.log(`No voice connection for guild [${guild_id}]`)
      return false
    }

    const stream_dispatcher = this.voice_connections.get(guild_id).play(stream)
    stream_dispatcher.on('speaking', (value) => {
      this.is_speaking = value
    })
  }

  leave_voice_channel = (guild_id) => {
    if (!this.voice_connections.has(guild_id)) {
      return
    }

    this.voice_connections.get(guild_id).disconnect()
    this.voice_connections.delete(guild_id)
  }

  send_message = (text, { text_channel_id, guild_id, user_id, no_voice }) => {

    if (!this.client.channels.cache.has(text_channel_id)) {
      throw `Text channel [${text_channel_id}] doesn't exist`
    }

    if ((!no_voice) && this.voice_connections.has(guild_id)) {
      this.tts_engine(text).then((stream) => {
        this.streams.push({
          'stream': stream,
          'guild_id': guild_id,
        })
      })
    }

    const text_channel = this.client.channels.cache.get(text_channel_id)
    if ((guild_id === undefined) || (user_id === undefined)) {
      text_channel.send(`${text}`)
      return
    }

    if (!this.client.guilds.cache.has(guild_id)) {
      throw `Guild [${guild_id}] doesn't exist`
    }

    const guild = this.client.guilds.cache.get(guild_id)
    if (!guild.members.cache.has(user_id)) {
      throw `Guild [${guild_id}] has no member [${user_id}]`
    }

    const user = guild.members.cache.get(user_id).user
    text_channel.send(`${user} - ${text}`)
  }

  _on_discord_ready = () => {
    console.log(`Logged in as ${this.client.user.tag}!`)
    console.log('This bot is part of the following guilds:')
    this.client.guilds.cache.forEach((guild, id) => {
      console.log(`  - ${guild.name} : ${id}`)
    })
  }

  _on_discord_message = async (msg) => {
    try {
      if (msg.author.bot) {
        return
      }

      const trimmed_msg = msg.content.trim()
      if (trimmed_msg[0] != _DISCORD_PREFIX) {
        return
      }

      const args = minimist(parseArgsStringToArgv(trimmed_msg.slice(1)))
      console.log(`\nReceived msg from: [${msg.guild}: ${msg.channel.name}]`)
      this.on_parsed_message({
        'guild_id': msg.guild.id,
        'guild_name': msg.guild.name,
        'channel_id': msg.channel.id,
        'channel_name': msg.channel.name,
        'user_id': msg.author.id,
        'user_name': msg.author.username,
        'args': args,
      })
    } catch (e) {
      console.log(`Caught exception while processing message: ${e}`);
    }
  }

  _on_audio_end = async (buffer, voice_channel, user, callback) => {
    buffer = Buffer.concat(buffer)
    const duration = buffer.length / _AUDIO_BITRATE / _BYTES_PER_PACKET;
    console.log("duration: " + duration)

    if (duration < _MIN_SPEECH_DURATION) {
      console.log("Speech fragment was too short")
      return
    }

    if (duration > _MAX_SPEECH_DURATION) {
      console.log("Speech fragment was too long")
      return
    }

    try {
      let new_buffer = await this._convert_audio(buffer)
      callback({
        'guild_id': voice_channel.guild.id,
        'guild_name': voice_channel.guild.name,
        'channel_id': voice_channel.id,
        'channel_name': voice_channel.name,
        'user_id': user.id,
        'user_name': user.username,
        'voice_buffer': new_buffer
      })
    } catch (e) {
      console.log(`Caught exception during transcription: ${e}`)
    }
  }

  _on_speaking = (callback, voice_channel, voice_connection, user, speaking) => {
    if (speaking.bitfield == 0 || user.bot) {
      return
    }
    console.log(`I'm listening to ${user.username}`)

    // this creates a 16-bit signed PCM, stereo 48KHz stream
    let buffer = [];

    const audio_stream = voice_connection.receiver.createStream(user, { mode: 'pcm' })
    audio_stream.on('data', (data) => { buffer.push(data) })
    audio_stream.on('end', () => { this._on_audio_end(buffer, voice_channel, user, callback) })
    audio_stream.on('error', (e) => { console.log(`Error while receiving audio: ${e}`) });
  }

  _convert_audio = async (input) => {
    try {
      // stereo to mono channel
      const data = new Int16Array(input)
      const ndata = new Int16Array(data.length / 2)
      for (let i = 0, j = 0; i < data.length; i += 4) {
        ndata[j++] = data[i]
        ndata[j++] = data[i + 1]
      }
      return Buffer.from(ndata);
    } catch (e) {
      console.log(e)
      console.log('convert_audio: ' + e)
      throw e;
    }
  }

  _get_channels = (guild_id, channel_type) => {
    if (!this.client.guilds.cache.has(guild_id)) {
      throw `invalid guild id: ${guild_id}`
    }

    const channels = new Map()
    const guild = this.client.guilds.cache.get(guild_id)
    console.log(`Looking for ${channel_type} channels in ${guild.name}`)
    guild.channels.cache.forEach((channel, id) => {
      if (channel.type === channel_type) {
        console.log(`  - ${channel.name}`)
        channels.set(channel.name, channel.id)
      }
    })

    return channels
  }
}

export {
  DiscordClient
}