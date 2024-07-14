import { OPENAI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function textToSpeech(text: string) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: "alloy"
    })
  });

  if (!response.ok) {
    throw new Error('Failed to convert text to speech');
  }

  return await response.arrayBuffer();
}

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
  const instructionId = url.searchParams.get('id');

  if (!instructionId) {
    console.error('Instruction ID is required');
    return json({ error: 'Instruction ID is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('meditation_instructions')
    .select('instruction')
    .eq('id', instructionId)
    .single();

  if (error || !data) {
    console.error(`Instruction not found for ID: ${instructionId}`, error);
    return json({ error: 'Instruction not found' }, { status: 404 });
  }

  try {
    const audioBuffer = await textToSpeech(data.instruction);
    
    console.log(`Sending audio for instruction: ${instructionId}`);

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="instruction_${instructionId}.mp3"`
      }
    });
  } catch (error) {
    console.error('Text-to-speech conversion failed:', error);
    return json({ error: 'Failed to generate audio' }, { status: 500 });
  }
};