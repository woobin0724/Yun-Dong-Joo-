#!/usr/bin/env node
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log(`
웹푸시용 VAPID 키를 만들었습니다. 아래 두 줄을 .env 에 넣으세요.
(공개 키는 브라우저에 전달되고, 비밀 키는 절대 밖으로 내보내지 마세요.)

VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
`);
