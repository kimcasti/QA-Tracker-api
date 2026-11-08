import test from 'node:test';
import assert from 'node:assert/strict';
import { createFunctionalityController } from './functionality';

test('generic functionality create preserves explicit null optional Canvas fields while omitted fields keep legacy defaults', async()=>{
  for(const clear of [true,false]){
    let saved:any;
    const strapi:any={documents:()=>({findMany:async()=>[],create:async({data}:any)=>{saved=data;return data;}})};
    const controller=createFunctionalityController({strapi,dependencies:{
      getUserMemberships:async()=>[{organization:{documentId:'org1'}}] as any,
      getAllowedOrganizationDocumentIds:()=>['org1'],
      getOrganizationDocumentIdFromPayload:async()=> 'org1',
      assertOrganizationLimitAvailable:async()=>({effectivePlan:'starter'}),
    }});
    const optional=clear?{status:null,priority:null,impactLevel:null,probabilityLevel:null,deliveryDate:null,sprint:null}:{};
    const ctx:any={state:{user:{id:1}},request:{body:{data:{code:'F1',name:'Only required name',project:'project1',...optional}}}};
    await controller.create(ctx);
    assert.equal(saved.status,clear?null:'backlog');
    for(const field of ['priority','impactLevel','probabilityLevel'])assert.equal(saved[field],clear?null:'medium');
    assert.equal(saved.deliveryDate,null);
    if(clear)assert.equal(saved.sprint,null);else assert.equal(Object.hasOwn(saved,'sprint'),false);
  }
});
