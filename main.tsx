import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { autoConnect } from '@unicitylabs/sphere-sdk/connect/browser'
import { SPHERE_NETWORKS, type ConnectClient } from '@unicitylabs/sphere-sdk/connect'
import './styles.css'

type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert'
type Tile = number // 0 is the empty slot; 1..8 are image tiles

type WalletState = {
  client: ConnectClient | null
  connected: boolean
  locked: boolean
  identity: any | null
  error: string | null
}

const IMAGE_URL = '/puzzle-image.jpeg'
const WALLET_URL = import.meta.env.VITE_SPHERE_WALLET_URL || 'https://sphere.unicity.network'
const TREASURY = import.meta.env.VITE_GAME_TREASURY || ''
const NETWORK = import.meta.env.VITE_SPHERE_NETWORK || 'testnet2'
const UCT_DECIMALS = Number(import.meta.env.VITE_UCT_DECIMALS || 8)
const MIN_STAKE = Number(import.meta.env.VITE_MIN_STAKE_UCT || 5)

const LEVELS: Record<Difficulty, { depth: number; suggested: number; icon: string }> = {
  Easy: { depth: 24, suggested: 5, icon: '◼' },
  Medium: { depth: 50, suggested: 5, icon: '◆' },
  Hard: { depth: 90, suggested: 5, icon: '✦' },
  Expert: { depth: 150, suggested: 5, icon: '✹' },
}

const GOAL: Tile[] = [1, 2, 3, 4, 5, 6, 7, 8, 0]

function neighbours(index: number) {
  const row = Math.floor(index / 3)
  const col = index % 3
  const out: number[] = []
  if (row > 0) out.push(index - 3)
  if (row < 2) out.push(index + 3)
  if (col > 0) out.push(index - 1)
  if (col < 2) out.push(index + 1)
  return out
}

function shufflePuzzle(depth: number): Tile[] {
  const board = [...GOAL]
  let empty = 8
  let previous = -1
  for (let i = 0; i < depth; i += 1) {
    const choices = neighbours(empty).filter((x) => x !== previous)
    const pick = choices[Math.floor(Math.random() * choices.length)]
    ;[board[empty], board[pick]] = [board[pick], board[empty]]
    previous = empty
    empty = pick
  }
  // Never start solved.
  if (board.every((value, index) => value === GOAL[index])) return shufflePuzzle(depth + 1)
  return board
}

function isSolved(board: Tile[]) {
  return board.every((value, index) => value === GOAL[index])
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function parseBaseUnits(value: string) {
  const clean = value.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error('Masukkan jumlah UCT yang valid.')
  const [whole, fraction = ''] = clean.split('.')
  if (fraction.length > UCT_DECIMALS) throw new Error(`Maksimal ${UCT_DECIMALS} angka desimal.`)
  return BigInt(whole) * 10n ** BigInt(UCT_DECIMALS) + BigInt((fraction + '0'.repeat(UCT_DECIMALS)).slice(0, UCT_DECIMALS))
}

function extractUctCoinId(assets: any): string | null {
  const list = Array.isArray(assets) ? assets : assets?.assets || assets?.items || []
  const uct = list.find((a: any) => String(a?.symbol || a?.ticker || '').toUpperCase() === 'UCT')
  const coinId = uct?.coinId || uct?.coin_id || uct?.id
  return typeof coinId === 'string' ? coinId : null
}

function App() {
  const [wallet, setWallet] = useState<WalletState>({ client: null, connected: false, locked: false, identity: null, error: null })
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy')
  const [stake, setStake] = useState(String(LEVELS.Easy.suggested))
  const [board, setBoard] = useState<Tile[]>(() => shufflePuzzle(LEVELS.Easy.depth))
  const [moves, setMoves] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [depositing, setDepositing] = useState(false)
  const [message, setMessage] = useState('Connect Sphere untuk mulai.')
  const [best, setBest] = useState<Record<Difficulty, number | null>>(() => {
    try { return JSON.parse(localStorage.getItem('uct-puzzle-best') || '{}') } catch { return {} as Record<Difficulty, number | null> }
  })
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const displayName = useMemo(() => wallet.identity?.nametag || wallet.identity?.directAddress || 'Sphere Wallet', [wallet.identity])
  const isConfigured = Boolean(TREASURY)

  const connectWallet = useCallback(async () => {
    setWallet((s) => ({ ...s, error: null }))
    setMessage('Membuka Sphere Wallet…')
    try {
      const result = await autoConnect({
        dapp: {
          name: 'UCT Sphere Puzzle',
          description: 'Sliding puzzle game with UCT testnet entry deposit',
          url: window.location.origin,
        },
        network: SPHERE_NETWORKS.testnet2,
        permissions: ['identity:read', 'tokens:read', 'balance:read', 'sign:request', 'transfer:request'],
        walletUrl: WALLET_URL,
        silent: false,
      })
      const client = result.client
      setWallet({ client, connected: true, locked: Boolean(result.connection.locked), identity: result.connection.identity, error: null })
      setMessage('Wallet terhubung. Pilih level dan deposit UCT.')

      client.on('wallet:locked', () => setWallet((s) => ({ ...s, locked: true })))
      client.on('wallet:unlocked', ({ identity }: any) => setWallet((s) => ({ ...s, locked: false, identity: identity ?? s.identity })))
      client.on('wallet:disconnected', () => setWallet({ client: null, connected: false, locked: false, identity: null, error: null }))
      client.on('identity:changed', (identity: any) => setWallet((s) => ({ ...s, identity })))
    } catch (error: any) {
      const text = error?.message || 'Gagal menghubungkan Sphere Wallet.'
      setWallet((s) => ({ ...s, error: text }))
      setMessage(text)
    }
  }, [])

  const disconnectWallet = useCallback(async () => {
    try { await wallet.client?.disconnect() } catch { /* noop */ }
    setWallet({ client: null, connected: false, locked: false, identity: null, error: null })
    setPlaying(false)
    setMessage('Wallet terputus.')
  }, [wallet.client])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setSeconds((v) => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [playing])

  const resetBoard = useCallback(() => {
    const level = LEVELS[difficulty]
    setBoard(shufflePuzzle(level.depth))
    setMoves(0)
    setSeconds(0)
    setPlaying(false)
    setMessage('Deposit selesai? Tekan tile untuk mulai bermain.')
  }, [difficulty])

  const changeDifficulty = (next: Difficulty) => {
    setDifficulty(next)
    setStake(String(LEVELS[next].suggested))
    setBoard(shufflePuzzle(LEVELS[next].depth))
    setMoves(0)
    setSeconds(0)
    setPlaying(false)
    setMessage(`Level ${next} dipilih.`)
  }

  const moveTile = (index: number) => {
    if (!playing || wallet.locked) return
    const empty = board.indexOf(0)
    if (!neighbours(empty).includes(index)) return
    const next = [...board]
    ;[next[empty], next[index]] = [next[index], next[empty]]
    const nextMoves = moves + 1
    setBoard(next)
    setMoves(nextMoves)
    if (isSolved(next)) {
      setPlaying(false)
      const oldBest = best[difficulty]
      if (oldBest == null || nextMoves < oldBest) {
        const updated = { ...best, [difficulty]: nextMoves }
        setBest(updated)
        localStorage.setItem('uct-puzzle-best', JSON.stringify(updated))
      }
      setMessage(`Puzzle selesai dalam ${nextMoves} langkah • ${formatTime(seconds)}.`)
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    dragStart.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return
    const dx = event.clientX - dragStart.current.x
    const dy = event.clientY - dragStart.current.y
    dragStart.current = null
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
      moveTile(index)
      return
    }
    const empty = board.indexOf(0)
    const row = Math.floor(index / 3)
    const col = index % 3
    let target = -1
    if (Math.abs(dx) > Math.abs(dy)) target = dx > 0 ? index - 1 : index + 1
    else target = dy > 0 ? index - 3 : index + 3
    if (target >= 0 && target < 9 && neighbours(empty).includes(index) && target === empty) moveTile(index)
    void row; void col
  }

  const depositAndPlay = async () => {
    if (!wallet.client || !wallet.connected) return setMessage('Hubungkan Sphere Wallet terlebih dahulu.')
    if (wallet.locked) return setMessage('Buka kunci Sphere Wallet terlebih dahulu.')
    if (!TREASURY) return setMessage('Treasury belum dikonfigurasi. Isi VITE_GAME_TREASURY di Vercel.')
    let amount: bigint
    try { amount = parseBaseUnits(stake) } catch (error: any) { return setMessage(error.message) }
    if (amount < BigInt(Math.round(MIN_STAKE * 10 ** UCT_DECIMALS))) return setMessage(`Minimum deposit adalah ${MIN_STAKE} UCT.`)

    setDepositing(true)
    setMessage('Memeriksa UCT dan menunggu konfirmasi di Sphere…')
    try {
      const assets = await wallet.client.query('sphere_getAssets')
      const coinId = extractUctCoinId(assets)
      if (!coinId) throw new Error('UCT coinId tidak ditemukan dari wallet. Pastikan wallet berada di testnet2 dan memiliki UCT.')
      const result: any = await wallet.client.intent('send', {
        to: TREASURY,
        amount: amount.toString(),
        coinId: coinId.toLowerCase(),
      })
      if (result?.deliveryPending) {
        setMessage('Deposit tersertifikasi, delivery masih pending. Game tetap dapat dimulai.')
      } else {
        setMessage(`Deposit ${stake} UCT berhasil. Selamat bermain!`)
      }
      setBoard(shufflePuzzle(LEVELS[difficulty].depth))
      setMoves(0)
      setSeconds(0)
      setPlaying(true)
    } catch (error: any) {
      setMessage(error?.message || 'Deposit gagal atau ditolak di Sphere Wallet.')
    } finally {
      setDepositing(false)
    }
  }

  return (
    <main className="page-shell">
      <section className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="eyebrow">SPHERE PUZZLE</div>
            <div className="muted">Unicity Testnet Arcade</div>
          </div>
        </div>
        {wallet.connected ? (
          <button className="wallet-button connected" onClick={disconnectWallet}>
            <span className="dot" /> {displayName.length > 24 ? `${displayName.slice(0, 20)}…` : displayName}
          </button>
        ) : (
          <button className="wallet-button" onClick={connectWallet}>Connect Sphere</button>
        )}
      </section>

      <section className="hero">
        <div>
          <span className="pill">UCT TESTNET • {NETWORK}</span>
          <h1>Slide. Solve. <span>Win the board.</span></h1>
          <p>Game puzzle geser 3×3 menggunakan artwork UCT. Connect Sphere terlebih dahulu, pilih level, lalu deposit UCT untuk membuka ronde.</p>
        </div>
        <div className="status-card">
          <div className="status-label">WALLET</div>
          <div className={`status-value ${wallet.connected ? 'ok' : ''}`}>{wallet.connected ? (wallet.locked ? 'Locked' : 'Connected') : 'Not connected'}</div>
          <div className="status-small">{wallet.error || message}</div>
        </div>
      </section>

      <section className="game-grid">
        <div className="game-panel">
          <div className="stats">
            <div><span>TIME</span><strong>{formatTime(seconds)}</strong></div>
            <div><span>MOVES</span><strong>{moves}</strong></div>
            <div><span>BEST</span><strong>{best[difficulty] ?? '—'}</strong></div>
          </div>

          <div className={`board ${!playing ? 'paused' : ''}`} aria-label="UCT sliding puzzle">
            {board.map((tile, index) => (
              <button
                key={`${index}-${tile}`}
                className={`tile ${tile === 0 ? 'empty' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerUp={(e) => handlePointerUp(index, e)}
                aria-label={tile === 0 ? 'Empty slot' : `Tile ${tile}`}
                style={tile === 0 ? undefined : {
                  backgroundImage: `url(${IMAGE_URL})`,
                  backgroundSize: '300% 300%',
                  backgroundPosition: `${((tile - 1) % 3) * 50}% ${Math.floor((tile - 1) / 3) * 50}%`,
                }}
              />
            ))}
          </div>

          <div className="message">{message}</div>
          <button className="reset" onClick={resetBoard}>↻ Shuffle {difficulty}</button>
        </div>

        <aside className="control-panel">
          <div className="section-title">Choose level</div>
          <div className="levels">
            {(Object.keys(LEVELS) as Difficulty[]).map((level) => (
              <button key={level} className={`level ${difficulty === level ? 'active' : ''}`} onClick={() => changeDifficulty(level)}>
                <span className="level-icon">{LEVELS[level].icon}</span>
                <span><b>{level}</b><small>{LEVELS[level].depth} shuffle moves</small></span>
                <strong>{LEVELS[level].suggested} UCT</strong>
              </button>
            ))}
          </div>

          <div className="stake-card">
            <div className="section-title">Deposit to play</div>
            <div className="input-wrap"><input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="UCT deposit amount" /><span>UCT</span></div>
            <p>Default tiap level: <b>{MIN_STAKE} UCT</b>. Kamu boleh menaikkan jumlah deposit.</p>
            <button className="play" onClick={depositAndPlay} disabled={depositing || !wallet.connected || wallet.locked}>
              {depositing ? 'Waiting for Sphere…' : wallet.connected ? `Deposit ${stake || '0'} UCT & Play` : 'Connect Sphere to Play'}
            </button>
            {!isConfigured && <div className="warning">⚠ Treasury belum di-set. Tambahkan <code>VITE_GAME_TREASURY</code> di Vercel.</div>}
          </div>

          <div className="rules">
            <div className="section-title">How to play</div>
            <ol>
              <li>Connect Sphere Wallet.</li>
              <li>Pilih level dan jumlah UCT.</li>
              <li>Approve transfer di Sphere.</li>
              <li>Geser tile sampai gambar kembali utuh.</li>
            </ol>
          </div>
        </aside>
      </section>

      <footer>
        <span>UCT Sphere Puzzle</span><span>Testnet only • No private keys are exposed to this game</span>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
