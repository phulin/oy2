export async function compressData(data: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(data));
			controller.close();
		},
	});

	const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
	const reader = compressedStream.getReader();
	const chunks: Uint8Array[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}

	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result.buffer;
}
