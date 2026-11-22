// ci points S3_ENDPOINT at a dead placeholder (localhost:9), so tests that write to the bucket can only run against a real one.
export const hasRealStorage = !/^https?:\/\/localhost:9\/?$/.test(process.env.S3_ENDPOINT ?? '');
