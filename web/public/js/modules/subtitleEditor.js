/**
 * Subtitle Editor Module
 * Manages subtitle generation UI and styling
 */

import { hexToASSColor, showToast } from '../utils/helpers.js';

export class SubtitleEditor {
  constructor() {
    this.sidebar = document.getElementById('subtitle-sidebar');
    this.btnClose = document.getElementById('btn-close-subtitle-sidebar');
    this.btnGenerate = document.getElementById('btn-generate-subs');
    this.btnBurn = document.getElementById('btn-burn-subs');
    this.subtitleList = document.getElementById('subtitle-list');
    this.subtitleItems = document.getElementById('subtitle-items');

    this.subtitles = [];
    this.isOpen = false;
    this.boldEnabled = false;

    this.onGenerate = null;
    this.onBurn = null;

    this._bindEvents();
  }

  _bindEvents() {
    this.btnClose.addEventListener('click', () => this.close());

    this.btnGenerate.addEventListener('click', () => {
      if (this.onGenerate) {
        this.onGenerate(this.getSettings());
      }
    });

    this.btnBurn.addEventListener('click', () => {
      if (this.onBurn) {
        this.onBurn(this.getStyle());
      }
    });

    // Bold toggle
    document.getElementById('sub-bold-on').addEventListener('click', () => {
      this.boldEnabled = true;
      document.getElementById('sub-bold-on').className = 'flex-1 text-xs py-2 border border-primary-300 bg-primary-50 rounded-lg text-primary-700 font-bold';
      document.getElementById('sub-bold-off').className = 'flex-1 text-xs py-2 border border-surface-200 rounded-lg hover:bg-primary-50 hover:border-primary-300 transition-colors font-medium text-surface-600';
    });

    document.getElementById('sub-bold-off').addEventListener('click', () => {
      this.boldEnabled = false;
      document.getElementById('sub-bold-off').className = 'flex-1 text-xs py-2 border border-primary-300 bg-primary-50 rounded-lg text-primary-700 font-medium';
      document.getElementById('sub-bold-on').className = 'flex-1 text-xs py-2 border border-surface-200 rounded-lg hover:bg-primary-50 hover:border-primary-300 transition-colors font-bold text-surface-600';
    });
  }

  open() {
    this.isOpen = true;
    this.sidebar.style.transform = 'translateX(0)';
  }

  close() {
    this.isOpen = false;
    this.sidebar.style.transform = 'translateX(100%)';
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  getSettings() {
    return {
      model: document.getElementById('sub-model').value,
      language: document.getElementById('sub-language').value,
    };
  }

  getStyle() {
    return {
      fontName: document.getElementById('sub-font').value,
      fontSize: parseInt(document.getElementById('sub-fontsize').value),
      primaryColor: hexToASSColor(document.getElementById('sub-color').value),
      outlineColor: hexToASSColor(document.getElementById('sub-outline-color').value),
      backColor: '&H80000000',
      bold: this.boldEnabled ? -1 : 0,
      outline: parseInt(document.getElementById('sub-outline').value),
      shadow: parseInt(document.getElementById('sub-shadow').value),
      alignment: parseInt(document.getElementById('sub-alignment').value),
      marginV: 30,
    };
  }

  setSubtitles(subtitles) {
    this.subtitles = subtitles;
    this._renderSubtitleList();
    this.btnBurn.classList.remove('hidden');
    this.subtitleList.classList.remove('hidden');
  }

  _renderSubtitleList() {
    this.subtitleItems.innerHTML = '';

    this.subtitles.forEach((sub, i) => {
      const div = document.createElement('div');
      div.className = 'bg-surface-50 rounded-lg p-3 group hover:bg-surface-100 transition-colors';
      div.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] font-mono text-surface-400">${this._formatTime(sub.start)} → ${this._formatTime(sub.end)}</span>
          <span class="text-[10px] text-surface-300">#${i + 1}</span>
        </div>
        <p class="text-xs text-surface-700 leading-relaxed">${sub.text}</p>
      `;
      this.subtitleItems.appendChild(div);
    });
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
