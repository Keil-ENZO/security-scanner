// État de la prod : le déploiement du dernier commit de la branche par défaut
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  return productionDeploy(t.repo)
})
