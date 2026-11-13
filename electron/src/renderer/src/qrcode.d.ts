declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
  const QRCode: {
    toDataURL(value: string, options?: QRCodeToDataURLOptions): Promise<string>;
  };
  export default QRCode;
}
