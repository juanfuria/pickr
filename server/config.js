export const config = {
  root: process.env.PICKR_ROOT ?? '/srv/pickr',
  port: Number(process.env.PICKR_PORT ?? 3100),
  publicUrl: (process.env.PICKR_URL ?? 'https://i.juan.is').replace(/\/+$/, ''),
  purgeUrl: (process.env.PICKR_PURGE_URL ?? 'http://127.0.0.1:8081').replace(/\/+$/, ''),
  trashDays: 30,
  maxEdge: 4096,
};
