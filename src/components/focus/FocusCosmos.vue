<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFocusThemeStore } from '@/stores/focusTheme'

/** 沉浸页 Canvas 粒子：按 focus theme 切换物理形态。 */
const props = defineProps<{ active: boolean }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const themeStore = useFocusThemeStore()

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  phase: number
  rotation: number
  spin: number
  tint: boolean
}

let context: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let frame = 0
let width = 0
let height = 0
let dpr = 1
let primaryRgb = '185, 210, 255'
let secondaryRgb = '255, 198, 220'
let pointerX = 0
let pointerY = 0
let targetX = 0
let targetY = 0
let reducedMotion = false
let motionQuery: MediaQueryList | null = null

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function paletteRefresh(): void {
  primaryRgb = readVar('--particle-color', '185, 210, 255')
  secondaryRgb = readVar('--particle-secondary', '255, 198, 220')
}

function makeParticle(): Particle {
  const theme = themeStore.theme
  const tint = Math.random() < 0.3

  if (theme === 'sunset') {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.12,
      size: 0.7 + Math.random() * 2.2,
      alpha: 0.22 + Math.random() * 0.52,
      phase: Math.random() * Math.PI * 2,
      rotation: 0,
      spin: 0,
      tint,
    }
  }

  if (theme === 'moon') {
    return {
      x: Math.random() * width,
      y: height * (0.25 + Math.random() * 0.9),
      vx: (Math.random() - 0.5) * 0.08,
      vy: 0.1 + Math.random() * 0.22,
      size: 0.9 + Math.random() * 2,
      alpha: 0.18 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      rotation: 0,
      spin: 0,
      tint,
    }
  }

  if (theme === 'snow') {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.12,
      vy: 0.12 + Math.random() * 0.28,
      size: 1.2 + Math.random() * 2.4,
      alpha: 0.4 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.012,
      tint,
    }
  }

  // forest：发光孢子，自下而上缓慢升腾
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.06,
    vy: 0.06 + Math.random() * 0.16,
    size: 0.6 + Math.random() * 2,
    alpha: 0.18 + Math.random() * 0.62,
    phase: Math.random() * Math.PI * 2,
    rotation: 0,
    spin: 0,
    tint,
  }
}

function buildParticles(): void {
  const count = width < 700 ? 48 : 92
  particles = Array.from({ length: count }, () => makeParticle())
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

function colorFor(particle: Particle, alpha: number): string {
  const rgb = particle.tint ? secondaryRgb : primaryRgb
  return `rgba(${rgb}, ${Math.max(0, Math.min(1, alpha))})`
}

function drawGlow(particle: Particle, x: number, y: number, alpha: number): void {
  if (!context) return
  const radius = particle.size * 5
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, colorFor(particle, alpha))
  gradient.addColorStop(0.35, colorFor(particle, alpha * 0.3))
  gradient.addColorStop(1, colorFor(particle, 0))
  context.fillStyle = gradient
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

function drawSnowflake(particle: Particle, x: number, y: number, alpha: number): void {
  if (!context) return
  const radius = particle.size * 1.8
  context.save()
  context.translate(x, y)
  context.rotate(particle.rotation)
  context.strokeStyle = colorFor(particle, Math.min(0.9, alpha))
  context.lineWidth = Math.max(0.6, particle.size * 0.28)
  for (let arm = 0; arm < 3; arm += 1) {
    const angle = (Math.PI / 3) * arm
    context.beginPath()
    context.moveTo(-Math.cos(angle) * radius, -Math.sin(angle) * radius)
    context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    context.stroke()
  }
  context.restore()
}

function updateAndDraw(particle: Particle, time: number): void {
  if (!context) return
  const theme = themeStore.theme
  const speed = props.active ? 1.55 : 1
  const parallax = 10 + particle.size * 5

  if (theme === 'sunset') {
    // 金色微尘：布朗运动
    particle.vx += (Math.random() - 0.5) * 0.012
    particle.vy += (Math.random() - 0.5) * 0.01
    particle.vx = Math.max(-0.24, Math.min(0.24, particle.vx))
    particle.vy = Math.max(-0.18, Math.min(0.18, particle.vy))
    particle.x += particle.vx * speed
    particle.y += particle.vy * speed

    if (particle.x < -12) particle.x = width + 12
    if (particle.x > width + 12) particle.x = -12
    if (particle.y < -12) particle.y = height + 12
    if (particle.y > height + 12) particle.y = -12
  } else if (theme === 'moon') {
    // 淡蓝萤火虫：上升 + 横向摆动 + 呼吸
    particle.y -= particle.vy * speed
    particle.x += Math.sin(time * 0.0006 + particle.phase) * 0.18 + particle.vx * 0.5
    if (particle.y < -20) {
      particle.y = height + 20
      particle.x = Math.random() * width
    }
    if (particle.x < -20) particle.x = width + 20
    if (particle.x > width + 20) particle.x = -20
  } else if (theme === 'snow') {
    // 雪花：重力下落 + 随风横漂 + Z 轴旋转
    particle.y += particle.vy * speed
    particle.x +=
      particle.vx * speed +
      Math.sin(time * 0.0007 + particle.phase) * 0.16 +
      Math.sin(time * 0.00023 + particle.phase * 1.7) * 0.1
    particle.rotation += particle.spin * speed
    if (particle.y > height + 24) {
      particle.y = -24
      particle.x = Math.random() * width
    }
    if (particle.x < -24) particle.x = width + 24
    if (particle.x > width + 24) particle.x = -24
  } else {
    // forest：魔法光尘自下而上升腾，正弦横摆 + 呼吸闪烁
    particle.y -= particle.vy * speed
    particle.x +=
      Math.sin(time * 0.0008 + particle.phase) * 0.24 +
      particle.vx * 0.35
    if (particle.y < -20) {
      particle.y = height + 20
      particle.x = Math.random() * width
    }
    if (particle.x < -20) particle.x = width + 20
    if (particle.x > width + 20) particle.x = -20
  }

  const px = particle.x + pointerX * parallax * 0.22
  const py = particle.y + pointerY * parallax * 0.16

  let alpha = particle.alpha
  if (theme === 'moon') {
    alpha *= 0.45 + 0.55 * Math.sin(time * 0.0014 + particle.phase)
  } else if (theme === 'forest') {
    alpha *= 0.55 + 0.45 * Math.sin(time * 0.001 + particle.phase)
  } else if (theme === 'sunset') {
    alpha *= 0.78 + 0.22 * Math.sin(time * 0.0008 + particle.phase)
  } else {
    alpha *= 0.7 + 0.3 * Math.sin(time * 0.0009 + particle.phase)
  }

  if (theme === 'snow') {
    drawSnowflake(particle, px, py, alpha)
    return
  }

  drawGlow(particle, px, py, alpha)
  context.fillStyle = colorFor(particle, Math.min(1, alpha + 0.18))
  context.beginPath()
  context.arc(px, py, particle.size, 0, Math.PI * 2)
  context.fill()
}

function drawStatic(): void {
  if (!context) return
  context.clearRect(0, 0, width, height)
  for (const particle of particles) updateAndDraw(particle, 0)
}

function tick(time: number): void {
  if (!context) return
  pointerX += (targetX - pointerX) * 0.035
  pointerY += (targetY - pointerY) * 0.035
  context.clearRect(0, 0, width, height)
  for (const particle of particles) updateAndDraw(particle, time)
  frame = window.requestAnimationFrame(tick)
}

function start(): void {
  if (reducedMotion) {
    drawStatic()
    return
  }
  if (frame) window.cancelAnimationFrame(frame)
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

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

function onMotion(event: MediaQueryListEvent): void {
  reducedMotion = event.matches
  if (reducedMotion) {
    stop()
    drawStatic()
  } else {
    start()
  }
}

onMounted(() => {
  paletteRefresh()
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = motionQuery.matches
  resize()
  start()
  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  motionQuery.addEventListener('change', onMotion)
})

watch(
  () => themeStore.theme,
  () => {
    paletteRefresh()
    buildParticles()
    if (reducedMotion) drawStatic()
  },
)

onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', resize)
  window.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('visibilitychange', onVisibility)
  motionQuery?.removeEventListener('change', onMotion)
})
</script>

<template>
  <canvas ref="canvasRef" class="focus-cosmos" aria-hidden="true"></canvas>
</template>

<style scoped>
.focus-cosmos {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
