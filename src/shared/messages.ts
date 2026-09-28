export type TranscriptMsg = { type: 'transcript'; text: string; isFinal: boolean };
export type ControlMsg = { type: 'start' } | { type: 'stop' };
export type StatusCode = 'listener-offline' | 'mic-denied' | 'network' | 'lost' | 'ok';
export type StatusMsg = { type: 'status'; code: StatusCode; detail?: string };
export type ListenerErrorMsg = { type: 'listener-error'; code: 'mic-denied' | 'network' };

export type ServerToClient = ControlMsg | StatusMsg;
export type ClientToServer = TranscriptMsg | ListenerErrorMsg;
