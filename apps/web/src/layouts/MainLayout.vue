<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <span class="logo">Fin</span> Observer
        <div class="sub">经济舆情监控平台</div>
      </div>
      <el-menu :default-active="$route.path" router class="menu">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="title">{{ $route.meta.title ?? '' }}</div>
        <div class="actions">
          <el-tag size="small" type="info" effect="plain">辅助信号 · 不构成投资建议</el-tag>
          <el-switch v-model="dark" active-text="暗色" size="small" />
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const menus = [
  { path: '/', title: '工作台', icon: 'Odometer' },
  { path: '/subscriptions', title: '订阅管理', icon: 'Star' },
  { path: '/search', title: '舆情检索', icon: 'Search' },
  { path: '/events', title: '事件流', icon: 'Histogram' },
  { path: '/fundflow', title: '资金走向', icon: 'Coin' },
  { path: '/signals', title: '预测信号', icon: 'TrendCharts' },
  { path: '/alerts', title: '预警中心', icon: 'Bell' },
  { path: '/settings', title: '系统设置', icon: 'Setting' },
];

const dark = ref(document.documentElement.classList.contains('dark'));

watch(dark, (v) => {
  document.documentElement.classList.toggle('dark', v);
  localStorage.setItem('fin-dark', v ? '1' : '0');
});
if (localStorage.getItem('fin-dark') === '1') {
  document.documentElement.classList.add('dark');
  dark.value = true;
}
</script>

<style scoped>
.layout { height: 100vh; }
.aside { border-right: 1px solid var(--el-border-color-light); background: var(--el-bg-color); }
.brand { padding: 18px 20px 12px; font-size: 18px; font-weight: 700; }
.logo { color: var(--fin-accent); }
.brand .sub { font-size: 12px; color: var(--el-text-color-secondary); font-weight: 400; margin-top: 2px; }
.menu { border-right: none; }
.header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--el-border-color-light); }
.header .title { font-size: 16px; font-weight: 600; }
.actions { display: flex; align-items: center; gap: 12px; }
.main { overflow-y: auto; }
</style>
