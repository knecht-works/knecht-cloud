export default defineComarkComponent({
  name: 'ChatComark',
  class: '*:first:mt-0 *:last:mb-0',
  // Agent replies can be steered by ticket text: raw HTML would run script on the dashboard.
  html: false,
})
