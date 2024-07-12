import type { RequestHandler } from '@sveltejs/kit';
import { meditationEventEmitter } from '$lib/meditationEventEmitter';

export const GET: RequestHandler = () => {
  console.log('SSE connection established');

  const stream = new ReadableStream({
    start(controller) {
      console.log('SSE stream started');
      const listener = (data: any) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };
      meditationEventEmitter.on('meditation', listener);
      return () => {
        console.log('SSE connection closed');
        meditationEventEmitter.off('meditation', listener);
      };
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
};