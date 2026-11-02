import './style.css';
import { Game } from './core/Game';

const game = new Game(document.getElementById('app')!);
(window as unknown as { __game: Game }).__game = game;
game.init().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:0;color:#fff;background:#200;padding:20px;white-space:pre-wrap;z-index:99';
  pre.textContent = '起動エラー:\n' + String((err as Error)?.stack ?? err);
  document.body.appendChild(pre);
});
