const STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  CONNECTED_BUSY: 'connected_busy',
  PLAYING_DEFAULT: 'playing_default',
}

const DISCORD_TEXT_CMD = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ATTACH: 'attach',
  DETACH: 'detach',
  PLAYER: 'player',
  START: 'start',
  CANCEL: 'cancel',
  CAPTURE: 'capture',
  RELEASE: 'release',
  RESPAWN: 'respawn',
  HELP: 'help'
}

const EVENT = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  SETTINGS_UPDATE_ASYNC: 'settings_update_async',
  SETTINGS_UPDATE: 'settings_update',
  SETTINGS_UPDATE_DONE: 'settings_update_done',
  START: 'start',
  GAME_DONE: 'game_done',
  GAME_UPDATE: 'game_update',
  END: 'end',
}

const TRANSITIONS = new Map([
  [STATE.DISCONNECTED, new Map([[EVENT.CONNECT, STATE.CONNECTED]])],

  [STATE.CONNECTED, new Map([
    [EVENT.DISCONNECT, STATE.DISCONNECTED],
    [EVENT.SETTINGS_UPDATE_ASYNC, STATE.CONNECTED_BUSY],
    [EVENT.SETTINGS_UPDATE, STATE.CONNECTED],
    [EVENT.START, STATE.PLAYING_DEFAULT]
  ])],

  [STATE.CONNECTED_BUSY, new Map([[EVENT.SETTINGS_UPDATE_DONE, STATE.CONNECTED]])],

  [STATE.PLAYING_DEFAULT, new Map([
    [EVENT.GAME_DONE, STATE.CONNECTED],
    [EVENT.GAME_UPDATE, STATE.PLAYING_DEFAULT],
  ])]
])

const HARDPOINT_A = 'orange'
const HARDPOINT_B = 'yellow'
const HARDPOINT_C = 'green'
const HARDPOINT_D = 'pink'
const HARDPOINT_E = 'purple'
const HARDPOINTS = [HARDPOINT_A, HARDPOINT_B, HARDPOINT_C, HARDPOINT_D, HARDPOINT_E]

const SPAWN_NAMES = ['pull ups', 'gazebo', 'junk', 'garage', 'driveway', 'hedge', 'garden north', 'garden south']
const SPAWNS = {
  'orange': {
    'capturing': ['gazebo', 'cherry', 'junk'],
    'other': ['garden north', 'garden south', 'garage'],
    'neutral': [['garage', 'garden north'], ['garden south']],
  },
  'yellow': {
    'capturing': ['pull ups', 'junk'],
    'other': ['garage', 'garden north'],
    'neutral': [['driveway'], ['hedge']]
  },
  'green': {
    'capturing': ['junk', 'cherry'],
    'other': ['pull ups', 'garage'],
    'neutral': [['driveway'], ['pull ups']]
  },
  'pink': {
    'capturing': ['garage', 'driveway'],
    'other': ['pull ups', 'junk', 'cherry'],
    'neutral': [['hedge'], ['junk']]
  },
  'purple': {
    'capturing': ['driveway', 'hedge'],
    'other': ['garden north', 'garden south'],
    'neutral': [['pull ups', 'garden north'], ['junk', 'garden south']]
  }
}

const INITIAL_DATA = {
  'discord': {
    'guild_id': null,
    'guild_name': null,
    'text_channel_id': null,
    'text_channel_name': null,
    'voice_channel_id': null,
    'voice_channel_name': null,
  },
  'players': {
    'SwappyG': {
      'id': '301155781531795456',
      'team': 'red',
      'is_capturing': false
    },
    'Mercyful': {
      'id': '163784467528417280',
      'team': 'blue',
      'is_capturing': false
    }
  },
  'start_time': Date.now(),
  'game_timer': 0.0,
  'hardpoint_owner': 'neutral',
  'active_point': null,
  'blue_team_score': 0,
  'red_team_score': 0,
  'clock': null,
  'hardpoint_clock': null,
  'game_time_limit': 300,
  'score_rate': '1',
  'hardpoint_names': null,
  'point_rotation_time': 60,
  'spawn_point_names': null,
  'latest_red_spawn': null,
  'latest_blue_spawn': null,
  'spawns': null
}

export {
  DISCORD_TEXT_CMD,
  STATE,
  EVENT,
  TRANSITIONS,
  HARDPOINTS,
  SPAWNS,
  SPAWN_NAMES,
  INITIAL_DATA
}