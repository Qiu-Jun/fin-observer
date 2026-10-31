<template>
  <el-card shadow="never" class="stat-card">
    <div class="label">{{ label }}</div>
    <div class="value" :style="{ color: color ?? 'var(--el-text-color-primary)' }">{{ value }}</div>
    <div v-if="hint" class="hint muted">{{ hint }}</div>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint?: string; color?: string }>();
</script>

<style scoped>
.stat-card .label { font-size: 12px; color: var(--el-text-color-secondary); }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
.stat-card .hint { margin-top: 4px; }
</style>
