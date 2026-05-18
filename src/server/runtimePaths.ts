import path from "node:path";

const defaultRootDir = process.cwd();

export const appRootDir = path.resolve(process.env.APP_ROOT_DIR ?? defaultRootDir);
export const dataDir = path.resolve(process.env.APP_DATA_DIR ?? path.join(appRootDir, "data"));
export const uploadsDir = path.resolve(process.env.APP_UPLOADS_DIR ?? path.join(dataDir, "uploads"));
export const logsDir = path.resolve(process.env.APP_LOG_DIR ?? path.join(appRootDir, "logs"));
export const clientDistDir = path.resolve(process.env.APP_CLIENT_DIST_DIR ?? path.join(appRootDir, "dist/client"));

