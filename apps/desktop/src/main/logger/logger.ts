import path from 'path'
// named imports on purpose: winston's CommonJS export carries its own `default`
// key, which defeats the interop helper Rollup emits for a default import and
// leaves the namespace undefined at runtime
import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { LOGS_PATH } from '../constants'

console.log('LOGS_PATH', LOGS_PATH)

const prettyJson = format.printf((info) => {
  const message =
    info.message !== null && typeof info.message === 'object' && info.message.constructor === Object
      ? JSON.stringify(info.message, null, 4)
      : info.message
  return `${info.level}: ${message}`
})

export const logger = createLogger({
  transports: [
    new transports.Console({
      // handleExceptions: true,
      // handleRejections: true,
      level: 'debug',
      format: format.combine(format.colorize(), format.prettyPrint(), format.splat(), format.simple(), prettyJson)
    }),
    new DailyRotateFile({
      filename: path.join(LOGS_PATH, 'logs-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '28d',
      handleExceptions: true,
      handleRejections: true,
      level: 'debug',
      format: format.combine(
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf((info) => `${info.level} ${info.timestamp} : ${info.message}`)
      )
    })
  ],
  exitOnError: false
})

export const rendererLogger = createLogger({
  transports: [
    new DailyRotateFile({
      filename: path.join(LOGS_PATH, 'renderer-logs-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '28d',
      handleExceptions: true,
      handleRejections: true,
      level: 'debug',
      format: format.combine(
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf((info) => `${info.level} ${info.timestamp} : ${info.message}`)
      )
    })
  ],
  exitOnError: false
})
