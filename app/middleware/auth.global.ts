// Global page guard (secure-by-default): every route requires a session except
// the public ones below. The mirror of server/middleware/auth.ts on the page
// side — new pages are protected automatically, no opt-in to forget.
const PUBLIC_ROUTES = ['/login']

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  const isPublic = PUBLIC_ROUTES.includes(to.path)

  if (!loggedIn.value && !isPublic) {
    return navigateTo('/login')
  }
  if (loggedIn.value && isPublic) {
    return navigateTo('/')
  }
})
