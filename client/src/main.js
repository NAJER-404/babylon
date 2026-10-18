// Client Application Entry Point
import { Game } from './game.js';

function bootstrap() {
  const game = new Game('renderCanvas');
  window.__game = game;
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
