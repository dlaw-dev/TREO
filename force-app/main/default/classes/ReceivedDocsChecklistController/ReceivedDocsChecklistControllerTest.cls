@isTest
public class ReceivedDocsChecklistControllerTest {

    @isTest
    static void testValidObjectAndField() {
        List<String> result = ReceivedDocsChecklistController.getPicklistOptions('Account', 'Type');
        System.assertNotEquals(null, result);
        System.assert(result.size() > 0, 'Expected picklist values for Account.Type');
    }

    @isTest
    static void testInvalidObject() {
        List<String> result = ReceivedDocsChecklistController.getPicklistOptions('FakeObject__xyz', 'SomeField__c');
        System.assertNotEquals(null, result);
        System.assertEquals(0, result.size());
    }

    @isTest
    static void testInvalidField() {
        List<String> result = ReceivedDocsChecklistController.getPicklistOptions('Account', 'NonExistentField__xyz');
        System.assertNotEquals(null, result);
        System.assertEquals(0, result.size());
    }
}
