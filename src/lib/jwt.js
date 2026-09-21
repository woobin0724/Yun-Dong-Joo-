import crypto from 'node:crypto';

/**
 * JWT(RS256) 검증. 라이브러리를 더 쓰지 않고 node:crypto 만으로 처리한다.
 *
 * 구글의 authorization code 흐름에서는 토큰을 구글 서버에서 TLS 로 직접 받아 오므로
 * 서명 검증을 건너뛰어도 된다고 구글 문서는 말한다. 그래도 검증한다.
 * 토큰 교환 주소가 잘못 설정되거나 중간에서 가로채이는 경우까지 막아 주고,
 * 비용은 공개키 한 번 받아 오는 것뿐이기 때문이다.
 */

const b64urlToBuffer = (value) => Buffer.from(String(value), 'base64url');

/** 서명은 보지 않고 내용만 열어 본다. 검증 전에 kid 를 알아낼 때 쓴다. */
export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('JWT 형식이 아닙니다.');

  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlToBuffer(headerPart).toString('utf8'));
    payload = JSON.parse(b64urlToBuffer(payloadPart).toString('utf8'));
  } catch {
    throw new Error('JWT 내용을 읽을 수 없습니다.');
  }

  return {
    header,
    payload,
    signingInput: `${headerPart}.${payloadPart}`,
    signature: b64urlToBuffer(signaturePart),
  };
}

/**
 * JWKS 에서 kid 에 맞는 키를 찾아 RS256 서명을 확인한다.
 *
 * @param {string} token
 * @param {{keys: object[]}} jwks
 * @returns {object} 서명이 맞으면 payload
 */
export function verifyRs256(token, jwks) {
  const { header, payload, signingInput, signature } = decodeJwt(token);

  if (header.alg !== 'RS256') {
    // alg: 'none' 같은 것을 받아들이면 검증이 통째로 무의미해진다.
    throw new Error(`지원하지 않는 서명 방식입니다: ${header.alg}`);
  }

  const jwk = (jwks?.keys || []).find((k) => k.kid === header.kid && (!k.alg || k.alg === 'RS256'));
  if (!jwk) throw new Error(`서명에 쓰인 키를 찾을 수 없습니다 (kid=${header.kid}).`);

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (!crypto.verify('sha256', Buffer.from(signingInput), publicKey, signature)) {
    throw new Error('서명이 맞지 않습니다.');
  }
  return payload;
}

/**
 * 내용(claim)이 우리 서비스의 것인지 확인한다.
 * 서명이 맞아도 다른 앱에 발급된 토큰일 수 있으므로 aud 확인이 특히 중요하다.
 *
 * @param {object} payload
 * @param {{issuers: string[], audience: string, now?: number, leewaySeconds?: number}} rules
 */
export function assertClaims(payload, { issuers, audience, now = Date.now(), leewaySeconds = 60 }) {
  const seconds = Math.floor(now / 1000);

  if (!issuers.includes(payload.iss)) {
    throw new Error(`발급자가 다릅니다: ${payload.iss}`);
  }
  // aud 는 문자열이거나 배열일 수 있다.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) {
    throw new Error('이 앱에 발급된 토큰이 아닙니다.');
  }
  if (typeof payload.exp !== 'number' || payload.exp + leewaySeconds < seconds) {
    throw new Error('만료된 토큰입니다.');
  }
  if (typeof payload.iat === 'number' && payload.iat - leewaySeconds > seconds) {
    throw new Error('아직 유효하지 않은 토큰입니다.');
  }
  if (!payload.sub) {
    throw new Error('사용자 식별자가 없습니다.');
  }
  return payload;
}
