import { connectionOf } from '../../../utils/integration-routes'

export default defineEventHandler(event => connectionOf(event).connection.store.status())
