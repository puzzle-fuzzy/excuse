export * from './admin/gateway'
/**
 * Admin repository — barrel re-export
 *
 * 函数已按业务域拆分到 `admin/` 子目录，本文件仅做统一导出，保持
 * `repositories/index.ts` 的 `export * from './admin.repo'` 以及
 * 测试文件 `import ... from '../src/repositories/admin.repo'` 的对外 API 不变。
 *
 * 域文件：overview / tasks / users / providers / projects / gateway。
 * `admin/internal.ts` 为跨域私有 helper（numberValue / iso），不在此导出。
 */
export * from './admin/overview'
export * from './admin/projects'
export * from './admin/providers'
export * from './admin/tasks'
export * from './admin/users'
