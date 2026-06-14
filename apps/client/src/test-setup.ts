import '@testing-library/jest-dom/vitest'

// Radix UI Popover / Dialog 在 jsdom 中需要 PointerCapture + scrollIntoView mock，
// 否则点击 trigger 时 Radix 内部会调用未实现的方法并抛错导致 popover 不渲染。
window.Element.prototype.hasPointerCapture = () => false
window.Element.prototype.setPointerCapture = () => {}
window.Element.prototype.releasePointerCapture = () => {}
window.Element.prototype.scrollIntoView = () => {}
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

