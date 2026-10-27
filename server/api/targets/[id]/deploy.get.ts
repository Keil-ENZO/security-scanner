// Production state: the deployment of the latest commit on the default branch
export default defineEventHandler(async (event) => {
  const t = targetRepo(Number(getRouterParam(event, 'id')))
  return productionDeploy(t.repo)
})
