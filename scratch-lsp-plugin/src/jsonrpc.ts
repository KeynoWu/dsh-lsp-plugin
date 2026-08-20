/**
 * LSP 协议传输层：Content-Length 帧编解码 + 请求/响应/通知管理。
 * 对齐设计文档 v2 §9 风险 2：vscode-languageserver-protocol 的编解码在 M1 之后引入，
 * 这里先用自写轻量 JSON-RPC（omp client.ts 同路，约百行），M2 再评估换库。
 */

/** 编码一条 JSON-RPC 消息为 Content-Length 帧。 */
export function encodeFrame(msg: unknown): Buffer {
  const body = JSON.stringify(msg)
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`, 'utf8')
}

export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** 从字节流中切出完整帧，返回解析后的消息列表。 */
export function createFrameParser(onMessage: (msg: RpcMessage) => void): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0)
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const headEnd = buf.indexOf('\r\n\r\n')
      if (headEnd === -1) return
      const head = buf.subarray(0, headEnd).toString('utf8')
      const m = /Content-Length:\s*(\d+)/i.exec(head)
      if (!m) {
        buf = buf.subarray(headEnd + 4)
        continue
      }
      const len = Number(m[1])
      if (buf.length < headEnd + 4 + len) return
      const body = buf.subarray(headEnd + 4, headEnd + 4 + len).toString('utf8')
      buf = buf.subarray(headEnd + 4 + len)
      try {
        onMessage(JSON.parse(body) as RpcMessage)
      } catch {
        // 丢弃无法解析的帧（服务器输出异常时的兜底）
      }
    }
  }
}
