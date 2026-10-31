import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '工作台', icon: 'Odometer' } },
    { path: '/subscriptions', name: 'subscriptions', component: () => import('../views/SubscriptionsView.vue'), meta: { title: '订阅管理', icon: 'Star' } },
    { path: '/search', name: 'search', component: () => import('../views/SearchView.vue'), meta: { title: '舆情检索', icon: 'Search' } },
    { path: '/events', name: 'events', component: () => import('../views/EventsView.vue'), meta: { title: '事件流', icon: 'Histogram' } },
    { path: '/fundflow', name: 'fundflow', component: () => import('../views/FundFlowView.vue'), meta: { title: '资金走向', icon: 'Coin' } },
    { path: '/signals', name: 'signals', component: () => import('../views/SignalsView.vue'), meta: { title: '预测信号', icon: 'TrendCharts' } },
    { path: '/alerts', name: 'alerts', component: () => import('../views/AlertsView.vue'), meta: { title: '预警中心', icon: 'Bell' } },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '系统设置', icon: 'Setting' } },
  ],
});

export default router;
