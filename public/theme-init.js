/* 화면이 그려지기 전에 테마를 정합니다. 그래야 밝은 화면이 한 번 번쩍이지 않습니다.
   CSP 에서 인라인 스크립트를 막아 두었기 때문에 별도 파일로 둡니다
   (해시를 예외 처리하면 스크립트를 고칠 때마다 해시도 같이 고쳐야 해서 깨지기 쉽습니다). */
try {
  const saved = localStorage.getItem('ydj.theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  const size = localStorage.getItem('ydj.textsize');
  if (size) document.documentElement.dataset.textsize = size;
} catch {}
