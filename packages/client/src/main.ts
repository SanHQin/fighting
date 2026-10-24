import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/base.css'
import { contentApi } from './api/client'
import { CHARS, setCharacterCatalog } from './mock/data'

const contentReady = contentApi.characters().then((chars) => {
  const fallback = new Map(CHARS.map((char) => [char.id, char]))
  setCharacterCatalog(chars.map((char) => ({ ...fallback.get(char.id), ...char })))
}).catch(() => setCharacterCatalog(CHARS))

const app = createApp(App)
app.use(createPinia())
app.use(router)
void contentReady.finally(() => app.mount('#app'))
