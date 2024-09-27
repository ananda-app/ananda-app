import { OPENAI_API_KEY } from '$env/static/private';

export async function textToSpeech(text: string): Promise<ArrayBuffer> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: "alloy",
      response_format: "mp3"  // Explicitly request MP3 format
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Text-to-speech conversion failed:', errorText);
    throw new Error('Failed to convert text to speech');
  }

  return await response.arrayBuffer();
}
