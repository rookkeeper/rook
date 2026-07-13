import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

export interface RemoteProxyHandle { close(): Promise<void>; }

export async function startRemoteProxy(bindIp: string, port: number, targetHost: string): Promise<RemoteProxyHandle> {
  const server = http.createServer((request, response) => proxyHttp(request, response, port, targetHost));
  server.on("upgrade", (request, socket, head) => proxyUpgrade(request, socket, head, port, targetHost));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindIp, () => { server.off("error", reject); resolve(); });
  });
  return { close: async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function proxyHttp(request: IncomingMessage, response: ServerResponse, port: number, host: string): void {
  const upstream = http.request({ host, port, method: request.method, path: request.url, headers: request.headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => response.end());
  request.pipe(upstream);
}

function proxyUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, port: number, host: string): void {
  const upstream = net.connect(port, host, () => {
    let raw = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
    for (let index = 0; index < request.rawHeaders.length; index += 2) raw += `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`;
    upstream.write(`${raw}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  const close = () => { socket.destroy(); upstream.destroy(); };
  socket.on("error", close);
  upstream.on("error", close);
}
