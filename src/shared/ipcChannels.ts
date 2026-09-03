export const IpcChannels = {
  GetDisplays: 'displays:get',
  OpenOutputWindow: 'output:open',
  CloseOutputWindow: 'output:close',
  SceneUpdate: 'scene:update',
  SceneRequestSync: 'scene:request-sync'
} as const
