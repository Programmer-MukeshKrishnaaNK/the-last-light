const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  loading = $('loading');
  fade = $('fadeLayer');
  title = $('titleCard');
  story = $('storyText');
  storySpan = $<HTMLSpanElement>('storyText').querySelector('span') as HTMLSpanElement;
  startPanel = $('startPanel');
  startBtn = $<HTMLButtonElement>('startBtn');
  prompt = $('prompt');
  promptKey = this.prompt.querySelector('.key') as HTMLElement;
  promptLabel = this.prompt.querySelector('.label') as HTMLElement;
  objective = $('objective');
  subtitle = $('subtitle');
  reticle = $('reticle');
  pause = $('pause');
  resumeBtn = $<HTMLButtonElement>('resumeBtn');
  restartBtn = $<HTMLButtonElement>('restartBtn');
  endCard = $('endCard');
  againBtn = $<HTMLButtonElement>('againBtn');

  private promptTimer = 0;
  private objTimer = 0;
  private subTimer = 0;

  hideLoading() {
    this.loading.classList.add('gone');
    setTimeout(() => this.loading.classList.add('hidden'), 900);
  }

  /** opacity 1 = fully black. */
  setFade(v: number, seconds = 1.4) {
    this.fade.style.transition = `opacity ${seconds}s ease`;
    this.fade.style.opacity = String(v);
  }

  setFadeColor(color: string) { this.fade.style.background = color; }

  showTitle(on: boolean) { this.title.classList.remove('hidden'); this.title.classList.toggle('show', on); }

  showStory(text: string | null) {
    if (!text) { this.story.classList.remove('show'); return; }
    this.story.classList.remove('hidden');
    this.storySpan.textContent = text;
    this.story.classList.add('show');
  }

  showStart(on: boolean) {
    this.startPanel.classList.remove('hidden');
    this.startPanel.classList.toggle('show', on);
    this.startPanel.style.pointerEvents = on ? 'auto' : 'none';
  }

  setPrompt(key: string | null, label = '') {
    if (!key) { this.prompt.classList.remove('show'); this.reticle.classList.remove('active'); return; }
    this.prompt.classList.remove('hidden');
    this.promptKey.textContent = key;
    this.promptLabel.textContent = label;
    this.prompt.classList.add('show');
    this.reticle.classList.add('active');
    this.promptTimer = 0.25;
  }

  setObjective(text: string | null, seconds = 7) {
    if (!text) { this.objective.classList.remove('show'); return; }
    this.objective.classList.remove('hidden');
    this.objective.textContent = text;
    this.objective.classList.add('show');
    this.objTimer = seconds;
  }

  say(text: string, seconds = 5) {
    this.subtitle.classList.remove('hidden');
    this.subtitle.textContent = text;
    this.subtitle.classList.add('show');
    this.subTimer = seconds;
  }

  showReticle(on: boolean) { this.reticle.classList.toggle('hidden', !on); }
  showPause(on: boolean) { this.pause.classList.toggle('hidden', !on); }

  showEnd() {
    this.endCard.classList.remove('hidden');
    setTimeout(() => this.endCard.classList.add('show'), 30);
    setTimeout(() => this.endCard.classList.add('reveal1'), 2600);
    setTimeout(() => this.endCard.classList.add('reveal2'), 5600);
    setTimeout(() => this.endCard.classList.add('reveal3'), 8000);
  }

  update(dt: number) {
    if (this.promptTimer > 0) {
      this.promptTimer -= dt;
      if (this.promptTimer <= 0) { this.prompt.classList.remove('show'); this.reticle.classList.remove('active'); }
    }
    if (this.objTimer > 0) {
      this.objTimer -= dt;
      if (this.objTimer <= 0) this.objective.classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subtitle.classList.remove('show');
    }
  }
}
