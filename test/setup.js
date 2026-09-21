/**
 * 테스트 환경 설정.
 *
 * ESM 은 import 를 먼저 평가하므로, 설정값을 만지는 일은 반드시
 * 앱 코드를 불러오기 "전에" 실행되는 별도 모듈에서 해야 한다.
 * helpers.js 는 이 파일을 가장 먼저 import 한다.
 */
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.ENABLE_SCHEDULER = 'false';
process.env.APP_TIMEZONE = 'Asia/Seoul';
