export interface MediaInfo {
  duration: number;
  streams: { codec_name: string; sample_rate: string; channels: number }[];
}
