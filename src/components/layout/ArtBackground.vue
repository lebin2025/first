<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useThemeStore, type ThemeName } from '@/stores/theme'

/**
 * 三套水彩插画背景。
 *
 * 结构：
 * - 底层：主题对应的 img，切换时交叉淡入；
 * - 中层：.art::after 主题遮罩（雾林/樱落提亮，雪乡压暗）；
 * - 上层：Canvas 粒子，随主题改变形态：
 *   雾林 = 青蓝光尘，樱落 = 粉色花瓣，雪乡 = 暖黄星点 / 雪花。
 */
const themeStore = useThemeStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

type ParticleShape = 'dust' | 'petal' | 'snow'

interface Particle {
  x: number
  y: number
  radius: number
  vx: number
  vy: number
  depth: number
  phase: number
  rot: number
  vr: number
  alpha: number
}

interface Ripple {
  x: number
  y: number
  radius: number
  life: number
}

const shapeByTheme: Record<ThemeName, ParticleShape> = {
  ride: 'dust',
  sakura: 'petal',
  winter: 'snow',
}

let context: CanvasRenderingContext2D | null = null
let frame = 0
let width = 0
let height = 0
let dpr = 1
let particles: Particle[] = []
let ripples: Ripple[] = []
let coreRgb = '196, 245, 238'
let glowRgb = '106, 198, 210'
let shape: ParticleShape = 'dust'
let reducedMotion = false
let lastTime = 0
let pointerX = 0
let pointerY = 0
let targetX = 0
let targetY = 0

function readRgb(variable: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value || fallback
}

function paletteRefresh(): void {
  coreRgb = readRgb('--particle-core', '196, 245, 238')
  glowRgb = readRgb('--particle-glow', '106, 198, 210')
  shape = shapeByTheme[themeStore.theme] ?? 'dust'
}

function makeParticle(randomY = true): Particle {
  const depth = 0.35 + Math.random() * 0.65
  const baseSpeed = shape === 'petal' ? 0.22 : shape === 'snow' ? 0.18 : 0.08
  return {
    x: Math.random() * width,
    y: randomY ? Math.random() * height : -20,
    radius:
      shape === 'dust'
        ? 0.9 + Math.random() * 2.1
        : shape === 'petal'
          ? 2.6 + Math.random() * 3.4
          : 1.2 + Math.random() * 2.2,
    vx: (shape === 'petal' ? -0.32 : 0.04) + (Math.random() - 0.5) * 0.16,
    vy: baseSpeed * (0.6 + depth) + (shape === 'snow' ? 0.14 : 0),
    depth,
    phase: Math.random() * Math.PI * 2,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.012,
    alpha: 0.25 + Math.random() * 0.55,
  }
}

function buildParticles(): void {
  const count = width < 700 ? 34 : 68
  particles = Array.from({ length: count }, () => makeParticle(true))
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context = canvas.getContext('2d')
  context?.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildParticles()
  if (reducedMotion) drawStatic()
}

function drawDust(particle: Particle): void {
  if (!context) return
  const x = particle.x + pointerX * 14 * particle.depth
  const y = particle.y + pointerY * 10 * particle.depth
  const pulse = 0.75 + Math.sin(particle.phase) * 0.25
  const alpha = particle.alpha * pulse

  const glow = context.createRadialGradient(
    x,
    y,
    0,
    x,
    y,
    particle.radius * 5.5,
  )
  glow.addColorStop(0, `rgba(${coreRgb}, ${alpha})`)
  glow.addColorStop(0.4, `rgba(${glowRgb}, ${alpha * 0.34})`)
  glow.addColorStop(1, `rgba(${glowRgb}, 0)`)
  context.fillStyle = glow
  context.beginPath()
  context.arc(x, y, particle.radius * 5.5, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = `rgba(${coreRgb}, ${Math.min(1, alpha * 1.25)})`
  context.beginPath()
  context.arc(x, y, particle.radius, 0, Math.PI * 2)
  context.fill()
}

function drawPetal(particle: Particle): void {
  if (!context) return
  const x = particle.x + pointerX * 18 * particle.depth
  const y = particle.y + pointerY * 12 * particle.depth
  context.save()
  context.translate(x, y)
  context.rotate(particle.rot)
  context.fillStyle = `rgba(${coreRgb}, ${particle.alpha * 0.86})`
  context.beginPath()
  context.ellipse(0, 0, particle.radius * 1.5, particle.radius * 0.72, 0, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = `rgba(${glowRgb}, ${particle.alpha * 0.45})`
  context.lineWidth = 0.7
  context.beginPath()
  context.moveTo(-particle.radius * 1.3, 0)
  context.quadraticCurveTo(0, particle.radius * 0.35, particle.radius * 1.3, 0)
  context.stroke()
  context.restore()
}

function drawSnow(particle: Particle): void {
  if (!context) return
  const x = particle.x + pointerX * 10 * particle.depth
  const y = particle.y + pointerY * 14 * particle.depth
  const alpha = particle.alpha
  context.save()
  context.translate(x, y)
  context.rotate(particle.rot * 0.35)
  context.strokeStyle = `rgba(${coreRgb}, ${alpha * 0.9})`
  context.lineWidth = 0.8
  const arm = particle.radius * 2.1
  for (let index = 0; index < 3; index += 1) {
    const angle = (Math.PI / 3) * index
    context.beginPath()
    context.moveTo(-Math.cos(angle) * arm, -Math.sin(angle) * arm)
    context.lineTo(Math.cos(angle) * arm, Math.sin(angle) * arm)
    context.stroke()
  }
  context.fillStyle = `rgba(${glowRgb}, ${alpha * 0.35})`
  context.beginPath()
  context.arc(0, 0, particle.radius * 1.7, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawRipples(): void {
  if (!context) return
  for (const ripple of ripples) {
    context.strokeStyle = `rgba(${coreRgb}, ${ripple.life * 0.38})`
    context.lineWidth = 1
    context.beginPath()
    context.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2)
    context.stroke()
  }
}

function drawStatic(): void {
  if (!context) return
  context.clearRect(0, 0, width, height)
  for (const particle of particles) {
    if (shape === 'dust') drawDust(particle)
    else if (shape === 'petal') drawPetal(particle)
    else drawSnow(particle)
  }
}

function tick(timestamp: number): void {
  if (!context) return
  const delta = Math.min(32, timestamp - (lastTime || timestamp))
  lastTime = timestamp
  pointerX += (targetX - pointerX) * 0.035
  pointerY += (targetY - pointerY) * 0.035

  context.clearRect(0, 0, width, height)

  for (const particle of particles) {
    particle.x += particle.vx * delta * 0.06
    particle.y += particle.vy * delta * 0.06
    particle.phase += 0.012
    particle.rot += particle.vr * delta * 0.06

    if (shape === 'petal') {
      particle.x += Math.sin(particle.phase * 0.8) * 0.22
      particle.rot += 0.0025
    } else if (shape === 'snow') {
      particle.x += Math.sin(particle.phase) * 0.08
    }

    if (particle.y > height + 30) {
      Object.assign(particle, makeParticle(false))
      particle.y = -20
    }
    if (particle.x < -30) particle.x = width + 20
    if (particle.x > width + 30) particle.x = -20

    if (shape === 'dust') drawDust(particle)
    else if (shape === 'petal') drawPetal(particle)
    else drawSnow(particle)
  }

  for (let index = ripples.length - 1; index >= 0; index -= 1) {
    const ripple = ripples[index]
    if (!ripple) continue
    ripple.radius += delta * 0.16
    ripple.life -= delta * 0.0015
    if (ripple.life <= 0) ripples.splice(index, 1)
  }
  drawRipples()

  frame = window.requestAnimationFrame(tick)
}

function start(): void {
  if (reducedMotion) {
    drawStatic()
    return
  }
  if (frame) window.cancelAnimationFrame(frame)
  lastTime = 0
  frame = window.requestAnimationFrame(tick)
}

function stop(): void {
  if (frame) {
    window.cancelAnimationFrame(frame)
    frame = 0
  }
}

function onPointerMove(event: PointerEvent): void {
  targetX = (event.clientX / Math.max(1, width) - 0.5) * 2
  targetY = (event.clientY / Math.max(1, height) - 0.5) * 2
}

function onPointerDown(event: PointerEvent): void {
  ripples.push({
    x: event.clientX,
    y: event.clientY,
    radius: 8,
    life: 1,
  })
  for (const particle of particles) {
    const dx = particle.x - event.clientX
    const dy = particle.y - event.clientY
    const distance = Math.hypot(dx, dy) || 1
    if (distance < 180) {
      const force = (1 - distance / 180) * 1.4
      particle.vx += (dx / distance) * force
      particle.vy += (dy / distance) * force
    }
  }
}

function onVisibilityChange(): void {
  if (document.hidden) stop()
  else start()
}

function onReducedMotionChange(event: MediaQueryListEvent): void {
  reducedMotion = event.matches
  if (reducedMotion) {
    stop()
    drawStatic()
  } else {
    start()
  }
}

let motionQuery: MediaQueryList | null = null

onMounted(() => {
  paletteRefresh()
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = motionQuery.matches
  resize()
  start()

  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  motionQuery.addEventListener('change', onReducedMotionChange)
})

watch(
  () => themeStore.theme,
  async () => {
    await nextTick()
    paletteRefresh()
    buildParticles()
    ripples = []
    if (reducedMotion) drawStatic()
  },
)

onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', resize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  motionQuery?.removeEventListener('change', onReducedMotionChange)
})
</script>

<template>
  <div class="art" aria-hidden="true">
    <Transition name="art-fade">
      <img
        :key="themeStore.theme"
        :src="themeStore.current.image"
        class="art__image"
        alt=""
        draggable="false"
      />
    </Transition>
    <canvas ref="canvasRef" class="art__canvas"></canvas>
  </div>
</template>

<style scoped>
.art {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background-color: var(--bg-base);
  background-image: var(--bg-image);
  background-position: center;
  background-size: cover;
  isolation: isolate;
}

.art::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--art-mask);
  pointer-events: none;
  transition: background-color var(--dur-theme) var(--ease-out);
}

.art__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: var(--art-filter);
  transform: scale(1.02);
  user-select: none;
}

.art__canvas {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
}

.art-fade-enter-active,
.art-fade-leave-active {
  transition:
    opacity 1.05s var(--ease-out),
    transform 1.4s var(--ease-out);
}

.art-fade-enter-from {
  opacity: 0;
  transform: scale(1.06);
}

.art-fade-leave-to {
  opacity: 0;
  transform: scale(1.01);
}
</style>
