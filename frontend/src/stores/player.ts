import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { playerApi, warehouseApi, characterApi, cardApi } from '@/services/api';
import type { PlayerProfile, Warehouse, Character, PlayerCard, Pagination } from '@/types';

export const usePlayerStore = defineStore('player', () => {
  const profile = ref<PlayerProfile | null>(null);
  const warehouse = ref<Warehouse | null>(null);
  const characters = ref<Character[]>([]);
  const myCards = ref<PlayerCard[]>([]);
  const cardPagination = ref<Pagination | null>(null);

  const loaded = computed(() => !!profile.value);

  async function fetchProfile() {
    const res = await playerApi.profile();
    profile.value = res.data;
    characters.value = res.data.characters as unknown as Character[];
  }

  async function claimOffline() {
    const res = await playerApi.offlineClaim();
    return res.data;
  }

  async function fetchWarehouse() {
    const res = await warehouseApi.get();
    warehouse.value = res.data;
  }

  async function fetchCharacters() {
    const res = await characterApi.list();
    characters.value = res.data;
  }

  async function fetchMyCards(page = 1, pageSize = 50) {
    const res = await cardApi.myList(page, pageSize);
    myCards.value = res.data;
    cardPagination.value = res.pagination;
  }

  function reset() {
    profile.value = null;
    warehouse.value = null;
    characters.value = [];
    myCards.value = [];
    cardPagination.value = null;
  }

  return {
    profile, warehouse, characters, myCards, cardPagination, loaded,
    fetchProfile, claimOffline, fetchWarehouse, fetchCharacters, fetchMyCards, reset,
  };
});
