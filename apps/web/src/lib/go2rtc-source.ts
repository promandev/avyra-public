/**
 * Construye el source string de go2rtc a partir de la URL almacenada de la cámara.
 *
 * Única fuente de verdad para WebRTC y HLS: ambos consumidores comparten el
 * MISMO stream en go2rtc (mismo `streamId`), así que si cada proxy registrara
 * un source distinto se pisarían entre sí en cada PUT/PATCH (esto causaba que
 * el HLS perdiera el audio: su versión anterior no incluía `#audio=`).
 *
 * Audio: se transcodifica a opus+aac en un único producer ffmpeg — go2rtc
 * sirve Opus a WebRTC y AAC a HLS desde la misma fuente. La sintaxis es
 * repetir el parámetro `#audio=` una vez por códec (NO una lista separada
 * por comas: "#audio=opus,aac" hace que ffmpeg trate "opus,aac" como nombre
 * de formato de salida literal y falle, matando el producer entero —
 * rompiendo WebRTC y HLS a la vez. go2rtc parsea `#audio=` repetido como
 * query params repetidos y añade un -map de salida por cada códec).
 */
export function buildGo2rtcSource(rawUrl: string): string {
  // ONVIF device URL → cliente nativo ONVIF de go2rtc (evita problemas de auth RTSP)
  if (/^https?:\/\//i.test(rawUrl) && rawUrl.includes('/onvif/')) {
    return rawUrl.replace(/^https?:\/\//i, 'onvif://');
  }

  // Stream HTTP genérico (MJPEG, etc.) — sin audio en la mayoría de fuentes MJPEG.
  if (/^https?:\/\//i.test(rawUrl)) {
    return `ffmpeg:${rawUrl}#video=h264`;
  }

  // RTSP vía ffmpeg. Si la URL ya es Opus nativo (IP Webcam h264_opus.sdp), copiar
  // ambas pistas tal cual. En el resto de casos transcodificar a opus+aac.
  const hasNativeOpus = /h264_opus\.sdp/i.test(rawUrl);
  return hasNativeOpus
    ? `ffmpeg:${rawUrl}#video=copy#audio=copy`
    : `ffmpeg:${rawUrl}#video=copy#audio=opus#audio=aac`;
}
