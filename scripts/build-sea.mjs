/**
 * SEA 构建脚本
 * 
 * 使用 Node.js 22+ 的 SEA (Single Executable Applications) 功能
 * 将编译后的代码打包成单个二进制文件
 */

import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const OUTPUT_DIR = join(ROOT_DIR, 'output')
const SEA_DIR = join(ROOT_DIR, 'sea')
const OUT_DIR = join(ROOT_DIR, 'out')

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * 构建 SEA 二进制
 */
async function buildSea() {
  console.log('🔨 Building SEA binary...')

  // 确保输出目录存在
  ensureDir(SEA_DIR)
  ensureDir(OUT_DIR)

  // 检查编译产物
  const cliEntry = join(OUTPUT_DIR, 'cli', 'run.js')
  if (!existsSync(cliEntry)) {
    console.error('❌ Error: CLI entry not found. Run "pnpm build" first.')
    console.error(`   Expected: ${cliEntry}`)
    process.exit(1)
  }

  // 创建 SEA 配置
  const seaShPath = join(SEA_DIR, 'sea.sh')
  const seaShContent = `#!/bin/sh
# This file is the entry point for the SEA binary
# It uses the Node.js SEA feature

# Find the Node.js binary
if [ -f "$(dirname "$0")/node" ]; then
  NODE="$(dirname "$0")/node"
else
  NODE="node"
fi

# Run the backup CLI
exec "$NODE" "$(dirname "$0")/cli/run.js" "$@"
`

  writeFileSync(seaShPath, seaShContent)

  // 构建 SEA
  console.log('📦 Creating SEA blob...')
  
  try {
    execSync(`node --experimental-sea-config ${seaShPath}`, {
      stdio: 'inherit',
      cwd: ROOT_DIR
    })
  } catch (error) {
    console.error('❌ SEA build failed')
    process.exit(1)
  }

  // 重命名输出
  const defaultBinary = join(ROOT_DIR, 'backup')
  const finalBinary = join(OUT_DIR, 'backup')
  
  if (existsSync(defaultBinary)) {
    execSync(`mv ${defaultBinary} ${finalBinary}`)
    execSync(`chmod +x ${finalBinary}`)
    console.log(`✅ SEA binary built: ${finalBinary}`)
  } else {
    console.error('❌ SEA binary not found after build')
    process.exit(1)
  }

  console.log('✨ Build complete!')
  console.log(`   Binary: ${finalBinary}`)
  console.log('')
  console.log('Usage:')
  console.log('  ./out/backup run --config backup.yaml')
}

buildSea()
