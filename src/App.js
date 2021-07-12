import { HardPoint } from './HardPoint.js'

const app = () => {
  const args = {
    'discord_token_file_path': 'keys/discord_token.json',
    'gspeech_key_file_path': 'keys/gspeech_key.json',
    'game_data_file_path': 'data/game_data.json'
  }

  try {
    const hardpoint = new HardPoint(args)
  } catch (e) {
    console.log(e)
  }
}

export {
  app
}