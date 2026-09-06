<template>
  <div
    class="relative window-drag flex items-center border-b border-border bg-card text-card-foreground h-10 select-none"
  >
    <div class="ms-3 flex items-center gap-2">
      <img :src="logoUrl" alt="Sotrama" class="h-5 w-5 object-contain" />
      <p v-if="companyName" class="text-sm font-semibold truncate max-w-48">
        {{ companyName }}
      </p>
      <p v-else class="text-sm font-semibold text-muted-foreground">
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
      <div
        class="window-no-drag flex items-center justify-center h-full w-11 hover:bg-accent hover:text-accent-foreground"
        @click="minimizeWindow"
      >
        <feather-icon name="minus" class="h-4 w-4 flex-shrink-0" />
      </div>
      <div
        class="window-no-drag flex items-center justify-center h-full w-11 hover:bg-accent hover:text-accent-foreground"
        @click="toggleMaximize"
      >
        <feather-icon
          v-if="isMax"
          name="minimize"
          class="h-3 w-3 flex-shrink-0"
        />
        <feather-icon v-else name="square" class="h-3 w-3 flex-shrink-0" />
      </div>
      <div
        class="window-no-drag flex items-center justify-center h-full w-11 hover:bg-destructive hover:text-destructive-foreground"
        @click="closeWindow"
      >
        <feather-icon name="x" class="h-4 w-4 flex-shrink-0" />
      </div>
    </div>
  </div>
</template>

<script>
import logoSrc from '../assets/img/app-logo.png';

export default {
  name: 'WindowsTitleBar',
  components: {},
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
    logoUrl() {
      return logoSrc;
    },
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
