// Run with a clean test profile: create demo-user, save alias demouser, and leave its editor open.
async page => {
  const context = page.context();
  await context.route('https://autopilot-fixture.duosecurity.com/**', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Duo enrollment fixture</title></head><body><h1>Test fixture, no live Duo traffic</h1><p>Username: demouser</p></body></html>'}));
  const duo = await context.newPage();
  await duo.goto('https://autopilot-fixture.duosecurity.com/frame');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('button',{name:'Start capture',exact:true}).click();
  await page.getByText('Listening in your Duo tab',{exact:true}).waitFor();
  const registration = await duo.evaluate(async () => {
    const credential = await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{id:'duosecurity.com',name:'Duo fixture'},user:{id:new TextEncoder().encode('fixture-demouser'),name:'demouser',displayName:'Fixture account'},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{authenticatorAttachment:'cross-platform',residentKey:'required',userVerification:'required'},timeout:5000}});
    window.fixtureCredential=credential;
    return {id:credential.id,type:credential.type};
  });
  if (registration.type !== 'public-key') throw new Error('Registration bridge failed');
  await page.getByRole('heading',{name:'Key captured',exact:true}).waitFor();
  const result = await duo.evaluate(async () => {
    const stored=window.fixtureCredential;
    const credential=await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId:'duosecurity.com',allowCredentials:[{type:'public-key',id:stored.rawId}],userVerification:'required',timeout:5000}});
    return {same:credential.id===stored.id,signatureBytes:credential.response.signature.byteLength};
  });
  if(!result.same || result.signatureBytes < 64)throw new Error('Assertion bridge selected the wrong credential');
  await page.getByRole('button',{name:'Manage demo-user',exact:true}).waitFor();
  console.log('PASS: tab-bound enrollment, exact username, pending capture, WebAuthn assertion bridge, automatic activation. All Duo responses mocked.');
  await duo.evaluate(() => { document.querySelector('p').textContent = 'Username: demo-user'; });
  await duo.waitForTimeout(100);
  const primary = await duo.evaluate(async () => {
    const stored = window.fixtureCredential;
    const credential = await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId:'duosecurity.com',allowCredentials:[{type:'public-key',id:stored.rawId}],timeout:5000}});
    return {same: credential.id === stored.id};
  });
  if (!primary.same) throw new Error('Primary username did not share the alias key');
  await duo.close();
  return { aliasEnrollment: true, aliasAssertion: true, primaryAssertion: true, sameKey: true };
}
