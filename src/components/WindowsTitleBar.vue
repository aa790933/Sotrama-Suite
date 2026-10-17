<template>
  <div
    class="relative window-drag flex items-center border-b border-border bg-card text-card-foreground h-10 select-none"
  >
    <div class="ms-3 flex items-center gap-2">
      <img
        src="../assets/img/sotrama-mark.svg"
        alt=""
        class="h-5 w-5 flex-shrink-0 rounded"
      />
      <p
        v-if="companyName"
        class="text-sm font-semibold tracking-tight text-foreground truncate max-w-48"
      >
        {{ companyName }}
      </p>
      <p
        v-else
        class="text-sm font-semibold tracking-tight text-muted-foreground"
      >
        Sotrama Suite
      </p>
      <span
        v-if="routeCrumb"
        class="hidden sm:inline text-xs text-muted-foreground truncate"
      >
        / {{ routeCrumb }}
      </span>
    </div>
    <div
      v-if="!isFullscreen"
      class="absolute window-no-drag flex h-full items-center right-0"
    >
      <button
        type="button"
        :aria-label="t`Minimize window`"
        :title="t`Minimize window`"
        class="window-no-drag flex items-center justify-center h-full w-11 hover:bg-accent hover:text-accent-foreground"
        @click="minimizeWindow"
      >
        <Minus class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        :aria-label="isMax ? t`Restore window` : t`Maximize window`"
        :title="isMax ? t`Restore window` : t`Maximize window`"
        class="window-no-drag flex items-center justify-center h-full w-11 hover:bg-accent hover:text-accent-foreground"
        @click="toggleMaximize"
      >
        <Minimize2 v-if="isMax" class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        <Square v-else class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        :aria-label="t`Close window`"
        :title="t`Close window`"
        class="window-no-drag flex items-center justify-center h-full w-11 hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-destructive"
        @click="closeWindow"
      >
        <X class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script>
import { t } from 'fyo';
import { Minus, Minimize2, Square, X } from 'lucide-vue-next';

export default {
  name: 'WindowsTitleBar',
  components: { Minus, Minimize2, Square, X },
  props: {
    dbPath: String,
    companyName: String,
  },
  data() {
    return {
      isMax: Boolean,
      isFullscreen: Boolean,
    };
  },
  computed: {
    routeCrumb() {
      const path = this.$route?.path ?? '';
      return path.replace(/^\//, '').replace(/\//g, ' / ');
    },
  },
  mounted() {
    this.getIsMaximized();
    this.getIsFullscreen();
    window.addEventListener('resize', this.getIsFullscreen);
    document.addEventListener('webkitfullscreenchange', this.getIsFullscreen);
    document.addEventListener('mozfullscreenchange', this.getIsFullscreen);
    document.addEventListener('fullscreenchange', this.getIsFullscreen);
    document.addEventListener('MSFullscreenChange', this.getIsFullscreen);
  },
  destroyed() {
    window.removeEventListener('resize', this.getIsFullscreen);
    document.removeEventListener(
      'webkitfullscreenchange',
      this.getIsFullscreen
    );
    document.removeEventListener('mozfullscreenchange', this.getIsFullscreen);
    document.removeEventListener('fullscreenchange', this.getIsFullscreen);
    document.removeEventListener('MSFullscreenChange', this.getIsFullscreen);
  },
  methods: {
    minimizeWindow() {
      ipc.minimizeWindow();
    },
    toggleMaximize() {
      ipc.toggleMaximize();
      this.getIsMaximized();
    },
    closeWindow() {
      ipc.closeWindow();
    },
    getIsMaximized() {
      ipc
        .isMaximized()
        .then((result) => {
          this.isMax = result;
        })
        .catch((error) => {
          console.error(error);
        });
    },
    getIsFullscreen() {
      ipc
        .isFullscreen()
        .then((result) => {
          this.isFullscreen = result;
        })
        .catch((error) => {
          console.error(error);
        });
    },
  },
};
</script>
