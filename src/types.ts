export interface Format {
  format_id: string;
  ext: string;
  resolution?: string;
  filesize?: number;
  filesize_approx?: number;
  vcodec: string;
  acodec: string;
  note?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  duration?: number;
  formats?: Format[];
  thumbnail?: string;
  thumbnails?: { url: string }[];
  webpage_url: string;
  url?: string;
  entries?: VideoInfo[];
  _type?: string;
}

export interface HistoryEntry {
  /** Download id, used to cancel this specific job. Absent on older entries. */
  id?: string;
  title: string;
  url: string;
  timestamp: string;
  path?: string;
  status?: string;
  progress?: number;
  speed?: string;
  eta?: string;
}

/** Transient per-download progress. Deliberately NOT part of Settings — keeping
 *  it out of the persisted blob is what stops settings.json being rewritten on
 *  every progress tick. Merged into history entries at render time. */
export interface LiveProgress {
  progress?: number;
  speed?: string;
  eta?: string;
  status?: string;
}

export interface Settings {
  autoAdvance: boolean;
  autoPaste: boolean;
  showActivity: boolean;
  dlSubtitles: boolean;
  showThumbnail: boolean;
  autoOpenFolder: boolean;
  /** Show the bottom-right start/finish notification cards. On by default. */
  desktopNotifications: boolean;
  concurrentDownloads: number;
  defaultResolution: string;
  history: HistoryEntry[];
  savePath: string;
  playlistDownload: boolean;
  /** Browser to lift cookies from ('' = off). Unlocks age-restricted/private videos. */
  cookiesFromBrowser: string;
  /** yt-dlp --limit-rate value, e.g. '2M' ('' = unlimited). */
  limitRate: string;
}

export interface DownloadProgress {
  status: string;
  title?: string;
  url?: string;
  progress?: number;
  speed?: string;
  eta?: string;
  path?: string;
}
