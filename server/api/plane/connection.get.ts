import { planeConnectionStatus } from '../../integrations/plane/credentials'

export default defineEventHandler(() => planeConnectionStatus())
