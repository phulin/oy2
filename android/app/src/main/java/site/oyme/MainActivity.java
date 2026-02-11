package site.oyme;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

public class MainActivity extends BridgeActivity
    implements ModifiedMainActivityForSocialLoginPlugin {

  @Override
  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
  }

  @Override
  public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
    // Required marker method for the social login plugin
  }
}
