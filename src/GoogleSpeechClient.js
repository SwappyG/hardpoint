import {
  v1p1beta1 as STT
} from '@google-cloud/speech'
import { TextToSpeechClient as TTSClient } from '@google-cloud/text-to-speech'
import { Duplex } from 'stream';

const STTClient = STT.SpeechClient

const _DEFAULT_CONFIG = {
  encoding: 'LINEAR16',
  sampleRateHertz: 48000,
  languageCode: 'en-US',
};

/**
 * Wraps google text-to-speech (TTS) and speech-to-text (STT) clients
 */
class GSpeechClient {
  constructor(project_id, json_key_file, key_phrases) {
    this.config = _DEFAULT_CONFIG
    if (Array.isArray(key_phrases)) {
      this.config = {
        ...this.config,
        speechContexts: [{
          phrases: key_phrases,
          boost: 10
        }]
      }
    }

    const credentials = {
      projectId: project_id,
      keyFilename: json_key_file,
    }

    this.stt_client = new STTClient(credentials)
    this.tts_client = new TTSClient(credentials)
  }

  transcribe_gspeech = async (buffer) => {
    try {
      const request = {
        audio: { content: buffer.toString('base64') },
        config: this.config,
      }

      const [response] = await this.stt_client.recognize(request);
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');
      console.log(`gspeech: ${transcription}`);
      return transcription;
    } catch (e) {
      console.log(`failed to transcribe speech, got [${e}]`)
    }
  }

  generate_speech = async (text) => {
    // Performs the text-to-speech request
    const [response] = await this.tts_client.synthesizeSpeech({
      'input': { 'text': text },
      'voice': { 'languageCode': 'en-US', 'ssmlGender': 'NEUTRAL' },
      'audioConfig': { 'audioEncoding': 'MP3' }
    });

    const stream = new Duplex()
    stream.push(response.audioContent)
    stream.push(null)
    return stream
  }
}

export {
  GSpeechClient
}