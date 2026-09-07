import { Game } from './game/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;

function boot() {
  try {
    const game = new Game(canvas);
    (window as unknown as { game: Game }).game = game;
    game.boot();
  } catch (err) {
    console.error(err);
    const el = document.querySelector('#loading .loading-text');
    if (el) el.textContent = 'this browser could not start the game (WebGL required)';
  }
}

// give the loading screen a moment to paint before the heavy build
setTimeout(boot, 40);
